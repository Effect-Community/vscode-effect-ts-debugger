import * as vscode from "vscode";

let effectDebuggerMode = true;

interface VSCodeDebuggerStoppedEvent {
  type: "event";
  event: "stopped";
}

const isVSCodeDebuggerStoppedEvent = (m: any): m is VSCodeDebuggerStoppedEvent =>
  m && m.type === "event" && m.event === "stopped";

const liveLogDecorationType = vscode.window.createTextEditorDecorationType({
  after: {
    margin: "0 0 0 3em",
    color: new vscode.ThemeColor("effectTsDebugger.inlineInfoForegroundColor"),
    backgroundColor: new vscode.ThemeColor("effectTsDebugger.inlineInfoBackgroundColor"),
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

let lastInlineInfoEditor: vscode.TextEditor | undefined = undefined;

async function clearInlineInfo() {
  if (lastInlineInfoEditor) {
    lastInlineInfoEditor.setDecorations(liveLogDecorationType, []);
  }
  lastInlineInfoEditor = undefined;
}

async function getEffectTsDebugInfo(session: vscode.DebugSession): Promise<void> {
  const thread = (await session.customRequest("threads", {})).threads[0];
  const stack = await session.customRequest("stackTrace", { threadId: thread.id });

  for (const frame of stack.stackFrames) {
    if (frame.presentationHint && frame.presentationHint === "label") {
      return;
    }
    if (frame.name === "runLoop") {
      try {
        const { variablesReference: fiberIdRef } = await session.customRequest("evaluate", {
          frameId: frame.id,
          expression: "this.id()",
        });

        if (fiberIdRef) {
          const { variables: fiberIdFields } = await session.customRequest("variables", {
            variablesReference: fiberIdRef,
          });
          const fiberId = {
            id: fiberIdFields.find((_: any) => _.name === "id").value,
            startTimeMillis: fiberIdFields.find((_: any) => _.name === "startTimeMillis").value,
          };
          if (typeof fiberId.id === "undefined" || typeof fiberId.startTimeMillis === "undefined") {
            return;
          }
          const position = new vscode.Position(
            stack.stackFrames[0].line,
            stack.stackFrames[0].column
          );
          const location = new vscode.Location(stack.stackFrames[0].source.path, position);
          const editor = vscode.window.activeTextEditor!;
          editor.revealRange(location.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          const livePosition = new vscode.Range(
            location.range.start.line - 1,
            Number.MAX_SAFE_INTEGER,
            location.range.start.line - 1,
            Number.MAX_SAFE_INTEGER
          );
          const contentText = `Fiber #${fiberId.id} (started at: ${new Date(
            JSON.parse(fiberId.startTimeMillis)
          ).toISOString()})`;
          editor.setDecorations(liveLogDecorationType, [
            {
              range: livePosition,
              renderOptions: { after: { contentText } },
            },
          ]);
          lastInlineInfoEditor = editor;
          return;
        }
      } catch (e) {
        if (
          typeof e === "object" &&
          e &&
          "message" in e &&
          typeof e["message"] === "string" &&
          e["message"].includes("async stack frame")
        ) {
          return;
        } else {
          throw e;
        }
      }
    }
  }
}

async function augmentDebugInfo(session: vscode.DebugSession) {
  clearInlineInfo();
  await getEffectTsDebugInfo(session);
}

let statusBarItem: vscode.StatusBarItem | undefined;
function updateStatusBarItem() {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    statusBarItem.command = "vscode-effect-ts-debugger.toggleDebuggerStep";
    statusBarItem.show();
  }
  if (statusBarItem) {
    statusBarItem.text = "Effect-TS: " + (!effectDebuggerMode ? "Off" : "On");
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
          if (effectDebuggerMode && isVSCodeDebuggerStoppedEvent(m)) {
            await augmentDebugInfo(session);
          }
        },
      };
    },
  });

  context.subscriptions.push(disposable);

  disposable = vscode.commands.registerCommand(
    "vscode-effect-ts-debugger.toggleDebuggerStep",
    () => {
      effectDebuggerMode = !effectDebuggerMode;
      updateStatusBarItem();
    }
  );

  context.subscriptions.push(disposable);

  disposable = vscode.commands.registerCommand(
    "vscode-effect-ts-debugger.jumpToEffectTrace",
    () => {
      const debugSession = vscode.debug.activeDebugSession;
      if (debugSession) {
        augmentDebugInfo(debugSession);
      }
    }
  );
  context.subscriptions.push(disposable);

  updateStatusBarItem();
}

export function deactivate() {}
