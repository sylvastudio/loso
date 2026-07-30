import type fs from "node:fs";

// Convert a Node read stream into a web ReadableStream that tolerates the
// client aborting mid-response (common when browsers cancel media requests
// after buffering one frame). Guards every controller call and destroys the
// underlying file handle on cancel, so no "Controller is already closed"
// uncaught exceptions leak out.
export function webStreamFromFile(stream: fs.ReadStream): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
        } catch {
          closed = true;
          stream.destroy();
        }
      });
      stream.on("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      stream.on("error", (err) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {
          /* already torn down */
        }
      });
    },
    cancel() {
      closed = true;
      stream.destroy();
    },
  });
}
