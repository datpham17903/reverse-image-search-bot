export type ComponentRef = { kind: "mode" | "modeSelect" | "yandex" | "pick"; key: string };

const PREFIX: Record<ComponentRef["kind"], string> = { mode: "m", modeSelect: "ms", yandex: "y", pick: "p" };
const KIND_BY_PREFIX = new Map<string, ComponentRef["kind"]>(
  (Object.entries(PREFIX) as [ComponentRef["kind"], string][]).map(([kind, prefix]) => [prefix, kind]),
);
const KEY = /^[A-Za-z0-9_-]{1,64}$/;

export function customId(r: ComponentRef): string {
  return `${PREFIX[r.kind]}:${r.key}`;
}

export function parseCustomId(id: string): ComponentRef | null {
  const i = id.indexOf(":");
  if (i < 0) return null;
  const kind = KIND_BY_PREFIX.get(id.slice(0, i));
  const key = id.slice(i + 1);
  return kind && KEY.test(key) ? { kind, key } : null;
}
