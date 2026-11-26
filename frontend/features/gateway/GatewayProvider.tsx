"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { gatewayService } from "./service";
import { type GatewayModel, type GatewayQuota } from "./types";

const MODEL_KEY = "sa-gateway-model";

type LoadState = "loading" | "ready" | "error";

interface GatewayContextValue {
  models: GatewayModel[];
  modelsState: LoadState;
  quota: GatewayQuota | null;
  quotaState: LoadState;
  quotaError: string | null;
  refreshQuota: () => void;
  /** `null` means the backend's configured default. */
  model: string | null;
  setModel: (model: string | null) => void;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

function readStoredModel(): string | null {
  try {
    return window.localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

function storeModel(model: string | null): void {
  try {
    if (model) window.localStorage.setItem(MODEL_KEY, model);
    else window.localStorage.removeItem(MODEL_KEY);
  } catch {
    // Storage disabled: the choice lasts until reload.
  }
}

export function GatewayProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [modelsState, setModelsState] = useState<LoadState>("loading");
  const [quota, setQuota] = useState<GatewayQuota | null>(null);
  const [quotaState, setQuotaState] = useState<LoadState>("loading");
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaNonce, setQuotaNonce] = useState(0);
  const [model, setModelState] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readStoredModel(),
  );

  useEffect(() => {
    let cancelled = false;
    gatewayService
      .listModels()
      .then((data) => {
        if (cancelled) return;
        setModels(data);
        setModelsState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setModels([]);
        setModelsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    gatewayService
      .getQuota()
      .then((data) => {
        if (cancelled) return;
        setQuota(data);
        setQuotaError(null);
        setQuotaState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setQuota(null);
        setQuotaError(err instanceof Error ? err.message : "Could not read the virtual key budget.");
        setQuotaState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [quotaNonce]);

  const refreshQuota = useCallback(() => setQuotaNonce((value) => value + 1), []);

  const setModel = useCallback((next: string | null) => {
    storeModel(next);
    setModelState(next);
  }, []);

  const value = useMemo(
    () => ({
      models,
      modelsState,
      quota,
      quotaState,
      quotaError,
      refreshQuota,
      model,
      setModel,
    }),
    [models, modelsState, quota, quotaState, quotaError, refreshQuota, model, setModel],
  );

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function useGateway(): GatewayContextValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) {
    throw new Error("useGateway must be used within GatewayProvider");
  }
  return ctx;
}
