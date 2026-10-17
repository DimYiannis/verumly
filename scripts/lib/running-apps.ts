import { connect } from 'node:net';

const APP_PORTS: Record<number, string> = { 3000: 'merchant-web', 3001: 'wallet', 4001: 'merchant-api', 4002: 'buyer-api' };

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Names of the apps currently listening on their default local ports. */
export async function runningApps(): Promise<string[]> {
  const up = await Promise.all(Object.keys(APP_PORTS).map(async (p) => ((await isListening(Number(p))) ? APP_PORTS[Number(p)]! : null)));
  return up.filter((x): x is string => x !== null);
}
