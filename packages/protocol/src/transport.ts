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

/**
 * Transport über einen Standard-WebSocket (Browser, Node ≥ 22 global). Der Socket muss
 * bereits geöffnet sein (`await openWebSocket(url)`).
 */
export class WebSocketTransport implements Transport {
  private frameHandler: FrameHandler | null = null;
  private closeHandler: (() => void) | null = null;
  private closed = false;
  private readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data;
      if (d instanceof ArrayBuffer) this.frameHandler?.(new Uint8Array(d));
    });
    ws.addEventListener('close', () => this.handleClose());
    ws.addEventListener('error', () => this.handleClose());
  }

  /** Noch nicht gesendete Bytes (Gegendruck). */
  get buffered(): number {
    return this.ws.bufferedAmount;
  }

  send(data: Uint8Array): void {
    if (this.closed || this.ws.readyState !== 1) return;
    this.ws.send(data as Uint8Array<ArrayBuffer>);
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
      this.ws.close();
    } catch {
      // bereits zu
    }
    this.handleClose();
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.();
  }
}

/** Öffnet einen WebSocket und wartet auf die Verbindung (Timeout in ms). */
export function openWebSocket(url: string, timeoutMs = 8000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Server ${url} antwortet nicht`));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`Verbindung zu ${url} fehlgeschlagen`));
    });
  });
}

/** Zwei verbundene Transports im selben Thread (Tests, Loopback). */
export function createLoopbackPair(): [Transport, Transport] {
  const channel = new MessageChannel();
  return [new PortTransport(channel.port1), new PortTransport(channel.port2)];
}
