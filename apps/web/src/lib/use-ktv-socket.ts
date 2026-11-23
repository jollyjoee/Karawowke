'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ClientMessage,
  type ClientRole,
  type PlayerState,
  type ReactionType,
  ServerMessageSchema,
  type ToastMessage,
} from '@ktv/shared';

export interface FloatingReaction {
  id: string;
  reaction: ReactionType;
  senderName: string;
  ts: number;
  offsetX: number;
}

export interface PlayerCommandEvent {
  seq: number;
  action: 'seek' | 'restart' | 'reload_media';
  timeSec?: number;
  pitchSemitones?: number;
}

export interface UseKtvSocketOptions {
  wsUrl: string;
  role: ClientRole;
  pin?: string;
  nickname?: string;
  clientId?: string;
  enabled?: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

export function useKtvSocket(options: UseKtvSocketOptions) {
  const { wsUrl, role, pin, nickname, clientId, enabled = true } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<ClientRole>(role);
  const [assignedClientId, setAssignedClientId] = useState<string | null>(clientId ?? null);
  const [state, setState] = useState<PlayerState | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [lastCommand, setLastCommand] = useState<PlayerCommandEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const commandSeqRef = useRef(0);

  const authParamsRef = useRef({ role, pin, nickname, clientId });
  authParamsRef.current = { role, pin, nickname, clientId };

  const pushToast = useCallback((toast: ToastMessage) => {
    setToasts((prev) => [...prev.slice(-3), toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, toast.durationMs ?? 4000);
  }, []);

  const send = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnectionStatus('disconnected');
      return;
    }

    let disposed = false;

    const clearTimers = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      clearTimers();
      setConnectionStatus('connecting');

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        reconnectAttemptRef.current = 0;
        setConnectionStatus('authenticating');
        setAuthError(null);

        const params = authParamsRef.current;
        ws.send(
          JSON.stringify({
            type: 'auth',
            role: params.role,
            pin: params.pin,
            nickname: params.nickname,
            clientId: params.clientId,
          } satisfies ClientMessage)
        );

        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', ts: Date.now() } satisfies ClientMessage));
          }
        }, 20_000);
      };

      ws.onmessage = (event) => {
        let json: unknown;
        try {
          json = JSON.parse(String(event.data));
        } catch {
          return;
        }

        const parsed = ServerMessageSchema.safeParse(json);
        if (!parsed.success) return;
        const msg = parsed.data;

        switch (msg.type) {
          case 'auth:ok':
            setConnectionStatus('connected');
            setAuthError(null);
            setActiveRole(msg.role);
            setAssignedClientId(msg.clientId);
            setState(msg.state);
            break;

          case 'auth:error':
            setAuthError(msg.message);
            if (msg.code === 'INVALID_PIN') {
              setConnectionStatus('disconnected');
            }
            break;

          case 'state:sync':
            setState(msg.state);
            break;

          case 'download:progress':
            setState((prev) => {
              if (!prev) return prev;
              const patchItem = <T extends NonNullable<PlayerState['currentItem']>>(item: T): T =>
                item.id === msg.itemId || item.videoId === msg.videoId
                  ? {
                      ...item,
                      downloadStatus: msg.status,
                      downloadProgress: msg.progress,
                      errorMessage: msg.errorMessage ?? null,
                    }
                  : item;

              return {
                ...prev,
                currentItem: prev.currentItem ? patchItem(prev.currentItem) : null,
                queue: prev.queue.map(patchItem),
              };
            });
            break;

          case 'pitch:status':
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                pitchSemitones: msg.pitchSemitones,
                pitchProcessing: msg.status === 'processing',
              };
            });
            break;

          case 'toast':
            pushToast(msg.toast);
            break;

          case 'reaction': {
            const reaction: FloatingReaction = {
              id: msg.id,
              reaction: msg.reaction,
              senderName: msg.senderName,
              ts: msg.ts,
              offsetX: Math.round((Math.random() - 0.5) * 90),
            };
            setReactions((prev) => [...prev.slice(-12), reaction]);
            setTimeout(() => {
              setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
            }, 3400);
            break;
          }

          case 'command':
            setLastCommand({
              seq: ++commandSeqRef.current,
              action: msg.action,
              timeSec: msg.timeSec,
              pitchSemitones: msg.pitchSemitones,
            });
            break;

          case 'error':
            pushToast({
              id: `err-${Date.now()}`,
              level: 'error',
              title: msg.message,
              durationMs: 4000,
            });
            break;

          case 'pong':
            break;
        }
      };

      ws.onclose = () => {
        clearTimers();
        if (disposed) return;
        setConnectionStatus('disconnected');
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will trigger exponential backoff reconnect
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const attempt = reconnectAttemptRef.current;
      const delayMs = Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4));
      reconnectAttemptRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(connect, delayMs);
    };

    connect();

    return () => {
      disposed = true;
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, enabled, role, pin, nickname, clientId, pushToast]);

  return {
    connectionStatus,
    authError,
    activeRole,
    clientId: assignedClientId,
    state,
    toasts,
    reactions,
    lastCommand,
    send,
    pushToast,
  };
}
