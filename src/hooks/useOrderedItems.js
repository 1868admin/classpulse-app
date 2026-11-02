import { useCallback, useEffect, useMemo, useState } from 'react';

export default function useOrderedItems(items, storageKey, getKey = (item) => item.id) {
  const [savedOrder, setSavedOrder] = useState([]);
  const keys = useMemo(
    () => [...new Set(items.map((item) => getKey(item)).filter(Boolean))],
    [items, getKey],
  );

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      setSavedOrder([]);
      return;
    }
    const parsed = JSON.parse(stored);
    setSavedOrder(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []);
  }, [storageKey]);

  const orderedKeys = useMemo(() => [
    ...savedOrder.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !savedOrder.includes(key)),
  ], [keys, savedOrder]);

  const orderedItems = useMemo(() => {
    const positions = new Map(orderedKeys.map((key, index) => [key, index]));
    return [...items].sort((left, right) =>
      (positions.get(getKey(left)) ?? Number.MAX_SAFE_INTEGER)
      - (positions.get(getKey(right)) ?? Number.MAX_SAFE_INTEGER));
  }, [items, orderedKeys, getKey]);

  const moveItem = useCallback((key, direction) => {
    const visibleKeys = new Set(keys);
    const order = [
      ...savedOrder.filter((savedKey) => !visibleKeys.has(savedKey)),
      ...orderedKeys,
    ];
    const index = order.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    setSavedOrder(order);
    localStorage.setItem(storageKey, JSON.stringify(order));
  }, [keys, orderedKeys, savedOrder, storageKey]);

  return { items: orderedItems, orderedKeys, moveItem };
}
