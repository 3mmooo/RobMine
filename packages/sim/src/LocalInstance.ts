import type { Transport } from '@robmine/protocol';
import { Instance, type InstanceOptions, type Session } from './Instance.ts';

export type { InstanceOptions } from './Instance.ts';

/**
 * Instanz mit genau einer Verbindung (Solo im Browser-Worker, Tests). Gleicher Kern wie der
 * Server – nur ohne Takt für Spielerpositionen.
 */
export class LocalInstance extends Instance {
  readonly session: Session;

  constructor(transport: Transport, opts: InstanceOptions) {
    super(opts);
    this.session = this.connect(transport);
  }

  get sessionState(): Session['state'] {
    return this.session.state;
  }

  close(): void {
    this.flushSave();
    this.session.close();
  }
}
