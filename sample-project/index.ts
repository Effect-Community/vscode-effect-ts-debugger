import * as E from "@effect/io/Effect";
import { pipe } from "@fp-ts/data/Function";
import { seconds } from "@fp-ts/data/Duration";

pipe(
  E.sync(() => Array.from({ length: 5 }, (_, n) => n)),
  E.flatMap(E.forEachPar((n) => E.delay(seconds(2))(E.succeed(n + 1)))),
  E.timed,
  E.flatMap(([{ millis }]) => E.log(`timed: ${millis} ms`)),
  E.tap(() =>
    E.async<never, never, void>((cb) => {
      setTimeout(() => cb(E.unit()), 100);
    })
  ),
  E.withParallelism(2),
  E.unsafeFork
);
