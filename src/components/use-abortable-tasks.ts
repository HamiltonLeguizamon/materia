"use client";

import { useCallback, useEffect, useRef } from "react";

export function useAbortableTasks() {
  const controllers = useRef(new Set<AbortController>());
  const beginTask = useCallback(() => {
    const controller = new AbortController();
    controllers.current.add(controller);
    return controller;
  }, []);
  const endTask = useCallback((controller: AbortController) => { controllers.current.delete(controller); }, []);
  useEffect(() => () => {
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
  }, []);
  return { beginTask, endTask };
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = () => { window.clearTimeout(timeout); reject(signal.reason); };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
