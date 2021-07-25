import * as vscode from "vscode";

let effectDebuggerStep = false;

function handleError(error: any) {
  console.log(error);
}

/**
 * This is the event triggered by the DAP when the code execution is stopped
 */
interface VSCodeDebuggerStoppedEvent {
  type: "event";
  event: "stopped";
}
const isVSCodeDebuggerStoppedEvent = (
  m: any
): m is VSCodeDebuggerStoppedEvent =>
  m && m.type === "event" && m.event === "stopped";

/**
 * Ensure a uri is a real existing file.
 * This is used to avoid loading packages with (@effect/module) in the path
 * eventually in the future we will find a way to get the real file path
 */
async function fileUriExists(jsUri: vscode.Uri) {
  try {
    const data = await vscode.workspace.fs.stat(jsUri);
    return data.type !== vscode.FileType.Directory;
  } catch (e) {}
  return false;
}

/**
 * Parse file:row:column string into its components
 */
function parseFileRowColumnFromTrace(
  traceString: string
): readonly [string, number, number] {
  const beforeColumn = traceString.lastIndexOf(":");
  const beforeRow = traceString.lastIndexOf(":", beforeColumn - 1);
  const column = parseInt(traceString.substr(beforeColumn + 1), 10);
  const row =
    parseInt(traceString.substring(beforeRow + 1, beforeColumn), 10) - 1;
  const file = traceString.substring(0, beforeRow);
  return [file, row, column];
}

type TraceElement = NoLocation | SourceLocation;
interface NoLocation {
  readonly _tag: "NoLocation";
}
interface SourceLocation {
  readonly _tag: "SourceLocation";
  readonly location: string;
}
interface EffectTsDebugInfo {
  fiberId: string;
  executionTraces: TraceElement[];
}

/**
 * Asks current effect-ts info to the current debug session
 */
async function getEffectTsDebugInfo(
  session: vscode.DebugSession
): Promise<EffectTsDebugInfo | null> {
  try {
    // first we need to get the current frame
    const resThreads = await session.customRequest("threads", {});
    for (const thread of resThreads.threads) {
      const resStackTrace = await session.customRequest("stackTrace", {
        threadId: thread.id,
      });

      // then we get the current fiber being evaluated
      const unsafeCurrentFiberDebugInfoExpression = `(function(){
    const F = global.require("@effect-ts/system/Fiber");
    const optionFiber = F.unsafeCurrentFiber();
    let data = null;
    if(optionFiber._tag === "Some"){
      const fiberContext = optionFiber.value
      const hasTraces = fiberContext.traceStatusEnabled
      const executionTraces = hasTraces && fiberContext.executionTraces 
        ? Array.from(fiberContext.executionTraces.list) 
        : []
      data = {
        fiberId: fiberContext.fiberId.seqNumber,
        executionTraces: executionTraces
      }
    }

    return JSON.stringify(data)
  })()
  `;

      const resUnsafeFiber = await session.customRequest("evaluate", {
        expression: unsafeCurrentFiberDebugInfoExpression,
        frameId: resStackTrace.stackFrames[0].id,
        context: "clipboard",
      });
      const resultJson = JSON.parse(resUnsafeFiber.result);
      const result: EffectTsDebugInfo | null = JSON.parse(resultJson);
      return result;
    }
  } catch (e) {
    handleError(e);
  }
  return null;
}

/**
 * Given a debug session and a effect-ts trace, try to resolve a valid vscode location
 */
async function getLocationFromTraceElement(
  session: vscode.DebugSession,
  trace: TraceElement
): Promise<vscode.Location | null> {
  try {
    if (trace._tag === "NoLocation") {
      return null;
    }

    const [file, row, column] = parseFileRowColumnFromTrace(trace.location);
    const absolutePath = session.workspaceFolder?.uri.toString() + "/" + file;

    const fileUri = vscode.Uri.parse(absolutePath);
    const position = new vscode.Position(row, column);
    const location = new vscode.Location(fileUri, position);

    if (!(await fileUriExists(fileUri))) {
      return null;
    }

    return location;
  } catch (e) {
    handleError(e);
  }
  return null;
}

/**
 * Move the editor cursor to the given location, opening a file if necessary.
 */
async function moveEditorPointerAtLocation(
  location: vscode.Location
): Promise<vscode.TextEditor | null> {
  try {
    const document = await vscode.workspace.openTextDocument(location.uri);
    const editor = await vscode.window.showTextDocument(document, 1, false);
    editor.selection = new vscode.Selection(
      location.range.start,
      location.range.end
    );
    editor.revealRange(
      location.range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
    return editor;
  } catch (e) {
    handleError(e);
  }
  return null;
}

const liveLogDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    margin: "0 0 0 3em",
    color: new vscode.ThemeColor("effectTsDebugger.inlineInfoForegroundColor"),
    backgroundColor: new vscode.ThemeColor(
      "effectTsDebugger.inlineInfoBackgroundColor"
    ),
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

interface EffectTsDebugTrace {
  fiberId: string;
  file: string;
  absolutePath: string;
  row: number;
  column: number;
}

async function injectDebuggerScript(session: vscode.DebugSession) {
  try {
    // then we inject the debugger script
    const debuggerScript = `(function(){
    /**
     * 
     * This source file is generated and required by the Effect Step Debugger.
     * Unfortunately in order to make the extension work, the JS execution will
     * be paused on this file. So this file appearing or flashing while debugging
     * is intended and there is'nt any known way to avoid it right now.
     * Have any idea to avoid it? Please open an issue in our git repo :D
     *
     **/
    const F = global.require("@effect-ts/system/Fiber");
    const oldTrace = F.FiberContext.prototype.addTrace;

    F.FiberContext.prototype.addTrace = function(trace){
      const value = oldTrace.call(this, trace)
      if(global.effectDebuggerStep && trace){
        debugger;
      }
      return value
    }

    global.effectDebuggerStep = ${JSON.stringify(effectDebuggerStep)}
  })()
  `;

    await session.customRequest("evaluate", {
      expression: debuggerScript,
    });

    return true;
  } catch (e) {
    // debugger has shut down before resolving
    if (e && e.name === "Canceled") {
      return false;
    }
    // error
    handleError(e);
  }
}

async function sendDebuggerSettings(session: vscode.DebugSession) {
  try {
    // then we inject the debugger script
    const debuggerScript = `(function(){
    global.effectDebuggerStep = ${JSON.stringify(effectDebuggerStep)};
  })()
  `;

    await session.customRequest("evaluate", {
      expression: debuggerScript,
    });

    return true;
  } catch (e) {
    // debugger has shut down before resolving
    if (e && e.name === "Canceled") {
      return false;
    }
    // error
    handleError(e);
  }
}

let lastInlineInfoEditor: vscode.TextEditor | undefined = undefined;
/**
 * Shows inline info when the debugger breaks
 */
async function setInlineInfo(
  editor: vscode.TextEditor,
  location: vscode.Location,
  info: EffectTsDebugInfo
) {
  try {
    clearInlineInfo();
    const livePosition = new vscode.Range(
      location.range.start.line,
      Number.MAX_SAFE_INTEGER,
      location.range.start.line,
      Number.MAX_SAFE_INTEGER
    );
    const contentText = "Fiber #" + info.fiberId;
    editor.setDecorations(liveLogDecorationType, [
      {
        range: livePosition,
        renderOptions: { after: { contentText } },
      },
    ]);
    lastInlineInfoEditor = editor;
  } catch (e) {
    handleError(e);
  }
}

/**
 * Clear the current inline info
 */
async function clearInlineInfo() {
  if (lastInlineInfoEditor) {
    lastInlineInfoEditor.setDecorations(liveLogDecorationType, []);
  }
  lastInlineInfoEditor = undefined;
}

/**
 * Jump to current effect-ts trace
 */
async function jumpToEffectTrace(
  session: vscode.DebugSession
): Promise<readonly [vscode.TextEditor, vscode.Location] | null> {
  try {
    await clearInlineInfo();
    const effectInfo = await getEffectTsDebugInfo(session);
    if (effectInfo) {
      const sourceLocation =
        effectInfo.executionTraces[effectInfo.executionTraces.length - 1];
      const location = await getLocationFromTraceElement(
        session,
        sourceLocation
      );
      if (location) {
        const editor = await moveEditorPointerAtLocation(location);
        if (editor) {
          await setInlineInfo(editor, location, effectInfo);
          return [editor, location];
        }
      }
    }
  } catch (e) {
    handleError(e);
  }
  return null;
}

let statusBarItem: vscode.StatusBarItem | undefined;
function updateStatusBarItem() {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right
    );
    statusBarItem.command = "vscode-effect-ts-debugger.toggleDebuggerStep";
    statusBarItem.show();
  }
  if (statusBarItem) {
    statusBarItem.text = "Effect-TS: " + (effectDebuggerStep ? "On" : "Off");
  }
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session: vscode.DebugSession) {
      injectDebuggerScript(session);

      return {
        onExit: () => {
          clearInlineInfo();
        },
        onWillStopSession: () => {
          clearInlineInfo();
        },
        onDidSendMessage: async (m) => {
          try {
            if (effectDebuggerStep && isVSCodeDebuggerStoppedEvent(m)) {
              await jumpToEffectTrace(session);
            }
          } catch (e) {
            handleError(e);
          }
        },
      };
    },
  });

  context.subscriptions.push(disposable);

  disposable = vscode.commands.registerCommand(
    "vscode-effect-ts-debugger.toggleDebuggerStep",
    () => {
      effectDebuggerStep = !effectDebuggerStep;
      updateStatusBarItem();
      const debugSession = vscode.debug.activeDebugSession;
      if (debugSession) {
        sendDebuggerSettings(debugSession);
      }
    }
  );
  context.subscriptions.push(disposable);

  disposable = vscode.commands.registerCommand(
    "vscode-effect-ts-debugger.jumpToEffectTrace",
    () => {
      const debugSession = vscode.debug.activeDebugSession;
      if (debugSession) {
        jumpToEffectTrace(debugSession);
      }
    }
  );
  context.subscriptions.push(disposable);

  updateStatusBarItem();
}

// this method is called when your extension is deactivated
export function deactivate() {}
