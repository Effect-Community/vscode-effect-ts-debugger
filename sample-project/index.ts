import * as T from "@effect/core/io/Effect";
import * as SUP from "@effect/core/io/Supervisor";
import * as RC from "@effect/core/io/RuntimeConfig";

const sendToDebugger = (data: any) => {
  debugger;
};

const supervisor = new SUP.Supervisor(
  SUP.none.value,
  SUP.none.unsafeOnStart,
  SUP.none.unsafeOnEnd,
  (fiber, eff) => {
    const instruction: T.Instruction = eff as any;
    const data = { fiberId: fiber._id.id, trace: instruction.trace };
    const wrapContinuation =
      <A>(obj: A) => <K extends keyof A>(key: K) => {
        const f: any = obj[key]
        obj[key] = ((...args: any[]) => {
          sendToDebugger(data)
          return f(...args)
        }) as any
      }

    if (instruction._tag === "SucceedNow") {
      sendToDebugger(data);
    } else if (instruction._tag === "Succeed") {
      wrapContinuation(instruction)("effect")
    } else if (instruction._tag === "SucceedWith") {
      wrapContinuation(instruction)("effect");
    } else if (instruction._tag === "FlatMap") {
      wrapContinuation(instruction)("k");
    } else if (instruction._tag === "Fail") {
      sendToDebugger(data)
    }
  },
  SUP.none.unsafeOnSuspend,
  SUP.none.unsafeOnResume
);

/**
 * @tsplus fluent ets/Effect enableDebugger
 */
export function enableDebugger<R, E, A>(
  effect: T.Effect<R, E, A>
): T.Effect<R, E, A> {
  return effect.modifyRuntimeConfig((runtime) =>
    RC.superviseOperations(runtime).addSupervisor(supervisor)
  );
}

const sample = T.succeed<number>(1)
  .map((e) => e * 2)
  .flatMap(a => T.fail(a))
  .flatMap((e) => T.succeed(e * 2))
  .enableDebugger();

T.unsafeRunAsync(sample);
