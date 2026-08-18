"use client";

import { useEffect, useState } from "react";

/**
 * Live congestion over a WebSocket, falling back to the existing poll.
 *
 * The socket is an optimisation on top of a path that already works, not a
 * replacement for it. Government networks eat WebSocket upgrades, so a failed
 * connection must degrade to the previous behaviour rather than freeze the
 * dashboard — `connected` is returned so the caller can keep polling while it
 * is false.
 *
 * No reconnect storm: one retry after a delay, then it stays on polling. A
 * console that retries a blocked upgrade every second is a console that spends
 * an overnight shift hammering a proxy.
 */
export interface LiveCongestion {
  congestion_index: number;
  suppressed_links: number;
  links: number;
}

export function useLiveCongestion(): {
  data: LiveCongestion | null;
  connected: boolean;
} {
  const [data, setData] = useState<LiveCongestion | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const url =
      process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8001/ws/live";
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let closed = false;

    const open = () => {
      if (closed) return;
      try {
        socket = new WebSocket(url);
      } catch {
        setConnected(false);
        return;
      }
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as LiveCongestion;
          setData(payload);
        } catch {
          // A malformed frame is not worth tearing the socket down for.
        }
      };
      socket.onclose = () => {
        setConnected(false);
        attempts += 1;
        if (attempts <= 1 && !closed) retry = setTimeout(open, 4000);
      };
      socket.onerror = () => socket?.close();
    };

    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return { data, connected };
}
