"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enableDebugger = void 0;
const T = require("@effect/core/io/Effect");
const SUP = require("@effect/core/io/Supervisor");
const RC = require("@effect/core/io/RuntimeConfig");
const sendToDebugger = (data) => {
    debugger;
};
const supervisor = new SUP.Supervisor(SUP.none.value, SUP.none.unsafeOnStart, SUP.none.unsafeOnEnd, (fiber, eff) => {
    const instruction = eff;
    const data = { fiberId: fiber._id.id, trace: instruction.trace };
    const wrapContinuation = (obj) => (key) => {
        const f = obj[key];
        obj[key] = ((...args) => {
            sendToDebugger(data);
            return f(...args);
        });
    };
    if (instruction._tag === "SucceedNow") {
        sendToDebugger(data);
    }
    else if (instruction._tag === "Succeed") {
        wrapContinuation(instruction)("effect");
    }
    else if (instruction._tag === "SucceedWith") {
        wrapContinuation(instruction)("effect");
    }
    else if (instruction._tag === "FlatMap") {
        wrapContinuation(instruction)("k");
    }
    else if (instruction._tag === "Fail") {
        sendToDebugger(data);
    }
}, SUP.none.unsafeOnSuspend, SUP.none.unsafeOnResume);
/**
 * @tsplus fluent ets/Effect enableDebugger
 */
function enableDebugger(effect) {
    return effect.modifyRuntimeConfig((runtime) => RC.superviseOperations(runtime).addSupervisor(supervisor));
}
exports.enableDebugger = enableDebugger;
const sample = T.succeed(1)
    .map((e) => e * 2)
    .flatMap(a => T.fail(a))
    .flatMap((e) => T.succeed(e * 2))
    .enableDebugger();
T.unsafeRunAsync(sample);
//# sourceMappingURL=index.js.map