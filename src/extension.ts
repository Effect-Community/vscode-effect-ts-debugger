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
): null | readonly [string, number, number] {
  const match = /^(\(.[^\)]+\)\s*)*(.+)\:(\d+)\:(\d+)$/ig.exec(traceString)
  if(match === null) return match
  const row = parseInt(match[3], 10) - 1;
  const column = parseInt(match[4], 10);
  const file = ''+match[2];
  return [file, row, column];
}

interface EffectTsDebugInfo {
  fiberId: string;
  trace: string | null;
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
      const unsafeCurrentFiberDebugInfoExpression = `JSON.stringify(arguments[0])`;

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
  trace: string | null
): Promise<vscode.Location | null> {
  try {
    if (!trace) return null
    const parsedTrace = parseFileRowColumnFromTrace(trace)
    if(!parsedTrace) return null
    const [file, row, column] = parsedTrace;
    //const absolutePath = session.workspaceFolder?.uri.toString() + "/" + file;

    const fileUri = vscode.Uri.file(file)
    const position = new vscode.Position(row, column);
    const location = new vscode.Location(fileUri, position);

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
        effectInfo.trace;
      const location = await getLocationFromTraceElement(
        session,
        sourceLocation
      );
      if (location) {
        if (!(await fileUriExists(location.uri))) {
          return await session.customRequest("continue");
        }
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
