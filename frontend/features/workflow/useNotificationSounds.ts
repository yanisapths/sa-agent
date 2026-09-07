"use client";

import { useChatSession } from "@/features/chat-session/ChatSessionProvider";
import type { SoundKind } from "@/features/chat-session/types";
import { Howl, Howler } from "howler";
import { useEffect, useRef } from "react";

import { fetchNotificationSound } from "./service";

export function useNotificationSounds() {
  const { session, soundsMuted } = useChatSession();
  const howlsRef = useRef<Partial<Record<SoundKind, Howl>>>({});
  const blobUrlsRef = useRef<string[]>([]);
  const lastPlayedRef = useRef(0);
  const queuedRef = useRef<SoundKind | null>(null);
  const mutedRef = useRef(soundsMuted);

  useEffect(() => {
    mutedRef.current = soundsMuted;
    Howler.mute(soundsMuted);
  }, [soundsMuted]);

  useEffect(() => {
    let cancelled = false;

    const unlock = () => {
      void Howler.ctx?.resume();
    };
    window.addEventListener("pointerdown", unlock);

    void (async () => {
      try {
        const [pendingUrl, readyUrl] = await Promise.all([
          fetchNotificationSound("pending"),
          fetchNotificationSound("ready"),
        ]);
        if (cancelled) {
          URL.revokeObjectURL(pendingUrl);
          URL.revokeObjectURL(readyUrl);
          return;
        }
        blobUrlsRef.current = [pendingUrl, readyUrl];
        howlsRef.current = {
          pending: new Howl({
            src: [pendingUrl],
            format: ["mp3"],
            html5: true,
            preload: true,
          }),
          ready: new Howl({
            src: [readyUrl],
            format: ["mp3"],
            html5: true,
            preload: true,
          }),
        };
        const queued = queuedRef.current;
        if (queued && !mutedRef.current) {
          howlsRef.current[queued]?.play();
          queuedRef.current = null;
        }
      } catch (err) {
        console.error("Failed to load notification sounds:", err);
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", unlock);
      for (const howl of Object.values(howlsRef.current)) {
        howl?.unload();
      }
      howlsRef.current = {};
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
      blobUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!session.settledAt || session.settledAt === lastPlayedRef.current) {
      return;
    }
    lastPlayedRef.current = session.settledAt;
    if (!session.soundKind || soundsMuted) {
      queuedRef.current = null;
      return;
    }
    const howl = howlsRef.current[session.soundKind];
    if (howl) {
      howl.stop();
      howl.play();
    } else {
      queuedRef.current = session.soundKind;
    }
  }, [session.settledAt, session.soundKind, soundsMuted]);
}

export function NotificationSounds() {
  useNotificationSounds();
  return null;
}
