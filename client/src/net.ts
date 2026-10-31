import type { ClientMsg, ServerMsg } from '../../shared/protocol';

type Handler = (m: ServerMsg) => void;

/** WebSocket client with reconnect and a ping/pong clock offset (server time -> local time). */
export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private queue: string[] = [];
  private samples: Array<{ rtt: number; offset: number }> = [];
  offset = 0; // serverNow - localNow
  get synced() { return this.samples.length > 0; }
  onOpen?: () => void;
  onClose?: () => void;
  private closedByUser = false;

  connect() {
    this.closedByUser = false;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
      for (const q of this.queue) ws.send(q);
      this.queue = [];
      this.samples = [];
      for (let i = 1; i < 5; i++) setTimeout(() => this.send({ type: 'ping', t: performance.now() }), i * 120);
      this.onOpen?.();
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'pong') {
        const now = performance.now();
        const rtt = now - m.t;
        this.samples.push({ rtt, offset: m.serverNow - (m.t + rtt / 2) });
        this.offset = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
        return;
      }
      for (const h of this.handlers) h(m);
    };
    ws.onclose = () => {
      this.ws = null;
      this.onClose?.();
    };
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(m: ClientMsg) {
    const s = JSON.stringify(m);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  /** Convert an absolute server timestamp to the local performance clock. */
  toLocal(serverMs: number) {
    return serverMs - this.offset;
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
  get userClosed() {
    return this.closedByUser;
  }
}
