import { describe, expect, it } from 'vitest';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { ProxyOptions } from 'vite';
import { devServer } from '../vite.config';

describe('workspace browser proxy', () => {
  it('allows the configured workspace host and proxies only the browser API', () => {
    const server = devServer('web--main--ari--owner.coder.foxberry.dev');
    expect(server.allowedHosts).toEqual(['web--main--ari--owner.coder.foxberry.dev', 'web--ari--owner.coder.foxberry.dev']);
    expect(Object.keys(server.proxy!)).toEqual(['/api']);
    const api = server.proxy!['/api'] as ProxyOptions;
    expect(api.target).toBe('http://127.0.0.1:38477');
    expect(api.changeOrigin).toBe(true);
  });

  it('adapts only the configured HTTPS browser origin to the loopback API', () => {
    const host = 'web--main--ari--owner.coder.foxberry.dev';
    let adapt!: (upstream: ClientRequest, request: IncomingMessage) => void;
    const api = devServer(host).proxy!['/api'] as ProxyOptions;
    api.configure!({ on(event: string, callback: typeof adapt) {
      expect(event).toBe('proxyReq');
      adapt = callback;
    } } as Parameters<NonNullable<ProxyOptions['configure']>>[0], api);
    for (const origin of [`https://${host}`, `https://${host.replace("--main--", "--")}`, 'https://attacker.test',
      `http://${host}`, `https://${host}.attacker.test`, undefined]) {
      const headers: Record<string, string> = {};
      adapt({ setHeader(name: string, value: string) { headers[name] = value; } } as ClientRequest,
        { headers: { origin } } as IncomingMessage);
      expect(headers).toEqual([`https://${host}`, `https://${host.replace("--main--", "--")}`].includes(origin || "") ? { origin: 'http://127.0.0.1:5175' } : {});
    }
    expect(devServer('').allowedHosts).toEqual([]);
  });
});
