/**
 * Transport-Abstraktion: Der Instanz-Kern spricht immer über ein Transport-Objekt –
 * lokal über MessagePort (Solo im Worker), online über WebSocket. Gleiche Rahmen,
 * gleiches Protokoll.
 */
export type FrameHandler = (data: Uint8Array) => void;

export interface Transport {
  send(data: Uint8Array): void;
  onFrame(handler: FrameHandler): void;
  onClose(handler: () => void): void;
  close(): void;
}

/** Transport über einen MessagePort (MessageChannel, Worker-Port). */
export class PortTransport implements Transport {
  private frameHandler: FrameHandler | null = null;
  private closeHandler: (() => void) | null = null;
  private closed = false;
  private readonly port: MessagePort;

  constructor(port: MessagePort) {
    this.port = port;
    port.onmessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (d instanceof Uint8Array) this.frameHandler?.(d);
      else if (d instanceof ArrayBuffer) this.frameHandler?.(new Uint8Array(d));
      else if (d === '__close') this.handleClose();
    };
    port.start?.();
  }

  send(data: Uint8Array): void {
    if (this.closed) return;
    // Kopie übertragen (Transfer), damit der Sender den Puffer weiterverwenden kann.
    const copy = data.slice();
    this.port.postMessage(copy, [copy.buffer]);
  }

  onFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    if (this.closed) return;
    try {
      this.port.postMessage('__close');
    } catch {
      // Port bereits geschlossen
    }
    this.handleClose();
    this.port.close();
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.();
  }
}

/** Zwei verbundene Transports im selben Thread (Tests, Loopback). */
export function createLoopbackPair(): [Transport, Transport] {
  const channel = new MessageChannel();
  return [new PortTransport(channel.port1), new PortTransport(channel.port2)];
}
