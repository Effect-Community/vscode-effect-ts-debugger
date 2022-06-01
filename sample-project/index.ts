import * as T from "@effect/core/io/Effect";
import * as SUP from "@effect/core/io/Supervisor";
import * as RC from "@effect/core/io/RuntimeConfig"

const supervisor = new SUP.Supervisor(
  SUP.none.value,
  SUP.none.unsafeOnStart,
  SUP.none.unsafeOnEnd,
  (fiber, eff) => {
      console.log(eff)
  },
  SUP.none.unsafeOnSuspend,
  SUP.none.unsafeOnResume
);

/**
 * @tsplus fluent ets/Effect enableDebugger
 */
export function enableDebugger<R, E, A>(effect: T.Effect<R, E, A>): T.Effect<R, E, A> {
    return effect.modifyRuntimeConfig((runtime) => RC.superviseOperations(runtime).addSupervisor(supervisor))
}

const sample = T.succeed<number>(1)
  .map((e) => e * 2)
  .flatMap((e) => T.succeed(e * 2))
  .enableDebugger()

T.unsafeRunAsync(sample);
