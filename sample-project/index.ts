import * as E from "@effect/io/Effect";
import * as F from "@effect/io/Fiber";
import { pipe } from "@fp-ts/data/Function";
import { seconds } from "@fp-ts/data/Duration";

pipe(
  E.sync(() => 0),
  E.flatMap(() =>
    E.fork(
      pipe(
        E.sync(() => 1),
        E.zipRight(E.sleep(seconds(3)))
      )
    )
  ),
  E.flatMap((_) => F.join(_)),
  E.flatMap(() =>
    E.tuplePar(
      E.delay(seconds(2))(E.sync(() => 0)),
      E.delay(seconds(2))(E.sync(() => 0)),
      E.delay(seconds(2))(E.sync(() => 0)),
      E.delay(seconds(2))(E.sync(() => 0))
    )
  ),
  E.withParallelism(2),
  E.unsafeFork
);
