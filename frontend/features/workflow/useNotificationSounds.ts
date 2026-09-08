"use client";

import { useChatSession } from "@/features/chat-session/ChatSessionProvider";
import type { SoundKind } from "@/features/chat-session/types";
import { Howl, Howler } from "howler";
import { useEffect, useRef } from "react";

import { fetchNotificationSound } from "./service";

type HowlMap = Partial<Record<SoundKind, Howl>>;

/** Module-scoped so Strict Mode remounts reuse the same Web Audio Howls. */
let howls: HowlMap = {};
let loadPromise: Promise<HowlMap> | null = null;

function playKind(kind: SoundKind): boolean {
  const howl = howls[kind];
  if (!howl) return false;
  howl.stop();
  howl.play();
  return true;
}

function loadHowls(): Promise<HowlMap> {
  if (howls.pending && howls.ready) return Promise.resolve(howls);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const [pendingUrl, readyUrl] = await Promise.all([
      fetchNotificationSound("pending"),
      fetchNotificationSound("ready"),
    ]);
    howls = {
      pending: new Howl({
        src: [pendingUrl],
        format: ["mp3"],
        preload: true,
        pool: 1,
      }),
      ready: new Howl({
        src: [readyUrl],
        format: ["mp3"],
        preload: true,
        pool: 1,
      }),
    };
    return howls;
  })().catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

export function useNotificationSounds() {
  const { session, soundsMuted } = useChatSession();
  const lastPlayedRef = useRef(0);
  const queuedRef = useRef<SoundKind | null>(null);
  const mutedRef = useRef(soundsMuted);

  useEffect(() => {
    mutedRef.current = soundsMuted;
    Howler.mute(soundsMuted);
  }, [soundsMuted]);

  useEffect(() => {
    const unlock = () => {
      void Howler.ctx?.resume();
    };
    window.addEventListener("pointerdown", unlock);

    void loadHowls()
      .then(() => {
        const queued = queuedRef.current;
        if (queued && !mutedRef.current) {
          playKind(queued);
          queuedRef.current = null;
        }
      })
      .catch((err) => {
        console.error("Failed to load notification sounds:", err);
      });

    return () => {
      window.removeEventListener("pointerdown", unlock);
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
    if (!playKind(session.soundKind)) {
      queuedRef.current = session.soundKind;
    }
  }, [session.settledAt, session.soundKind, soundsMuted]);
}

export function NotificationSounds() {
  useNotificationSounds();
  return null;
}
