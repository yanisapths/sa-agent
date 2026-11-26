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

import { clearConnections } from "@/features/connections/store";
import { useConnections, type UseConnections } from "@/features/connections/useConnections";

import { effectiveCapabilities, type EffectiveCapabilities } from "./capabilities";
import { productService } from "./service";
import {
  DEFAULT_PRODUCT_ID,
  type Product,
  type ProductInput,
  type ProductPatch,
} from "./types";

const STORAGE_KEY = "sa-product";

export type ProductDialog = "add" | "connections" | null;

interface ProductContextValue {
  products: Product[];
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Known before the list loads, so chats and folders can scope immediately. */
  activeId: string;
  active: Product | null;
  capabilities: EffectiveCapabilities;
  /** The active product's browser-held connections. */
  connections: UseConnections;
  switchTo: (id: string) => void;
  refresh: () => Promise<void>;
  create: (input: ProductInput) => Promise<Product>;
  update: (id: string, patch: ProductPatch) => Promise<Product>;
  remove: (id: string) => Promise<void>;
  dialog: ProductDialog;
  openDialog: (dialog: Exclude<ProductDialog, null>) => void;
  closeDialog: () => void;
}

const ProductContext = createContext<ProductContextValue | null>(null);

function readStoredId(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_PRODUCT_ID;
  } catch {
    return DEFAULT_PRODUCT_ID;
  }
}

function storeId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage disabled: the choice lasts until reload.
  }
}

export function ProductProvider({
  children,
  dialogs,
}: {
  children: ReactNode;
  /** Rendered inside the provider so dialogs can call `useProduct()`. */
  dialogs?: ReactNode;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  // Nothing rendered on the server depends on the id, so reading storage here cannot mismatch hydration.
  const [activeId, setActiveId] = useState<string>(() =>
    typeof window === "undefined" ? DEFAULT_PRODUCT_ID : readStoredId(),
  );
  const [dialog, setDialog] = useState<ProductDialog>(null);

  const applyList = useCallback((data: Product[]) => {
    setProducts(data);
    setActiveId((current) => {
      if (data.some((item) => item.id === current)) return current;
      storeId(DEFAULT_PRODUCT_ID);
      return DEFAULT_PRODUCT_ID;
    });
    setStatus("ready");
    setError(null);
  }, []);

  const applyError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : "Failed to load products");
    setStatus("error");
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyList(await productService.list());
    } catch (err: unknown) {
      applyError(err);
    }
  }, [applyList, applyError]);

  useEffect(() => {
    let cancelled = false;
    productService
      .list()
      .then((data) => {
        if (!cancelled) applyList(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) applyError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [applyList, applyError]);

  const switchTo = useCallback((id: string) => {
    storeId(id);
    setActiveId(id);
  }, []);

  const create = useCallback(async (input: ProductInput) => {
    const created = await productService.create(input);
    setProducts((prev) => [...prev, created]);
    setStatus("ready");
    setError(null);
    return created;
  }, []);

  const update = useCallback(async (id: string, patch: ProductPatch) => {
    const updated = await productService.update(id, patch);
    setProducts((prev) => prev.map((item) => (item.id === id ? updated : item)));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await productService.delete(id);
    clearConnections(id);
    setProducts((prev) => prev.filter((item) => item.id !== id));
    setActiveId((current) => {
      if (current !== id) return current;
      storeId(DEFAULT_PRODUCT_ID);
      return DEFAULT_PRODUCT_ID;
    });
  }, []);

  const openDialog = useCallback((next: Exclude<ProductDialog, null>) => setDialog(next), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const active = useMemo(
    () => products.find((item) => item.id === activeId) ?? null,
    [products, activeId],
  );
  const connections = useConnections(activeId);
  const capabilities = useMemo(
    () => effectiveCapabilities(active, connections.kinds, connections.isLocked),
    [active, connections.kinds, connections.isLocked],
  );

  const value = useMemo(
    () => ({
      products,
      status,
      error,
      activeId,
      active,
      capabilities,
      connections,
      switchTo,
      refresh,
      create,
      update,
      remove,
      dialog,
      openDialog,
      closeDialog,
    }),
    [
      products,
      status,
      error,
      activeId,
      active,
      capabilities,
      connections,
      switchTo,
      refresh,
      create,
      update,
      remove,
      dialog,
      openDialog,
      closeDialog,
    ],
  );

  return (
    <ProductContext.Provider value={value}>
      {children}
      {dialogs}
    </ProductContext.Provider>
  );
}

export function useProduct(): ProductContextValue {
  const ctx = useContext(ProductContext);
  if (!ctx) {
    throw new Error("useProduct must be used within ProductProvider");
  }
  return ctx;
}
