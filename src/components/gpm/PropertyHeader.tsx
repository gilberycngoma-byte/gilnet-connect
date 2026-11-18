import type { Property } from "@/lib/types";

export function PropertyHeader({
  code,
  property,
}: {
  code: string;
  property: Property | null;
}) {
  const name = property?.name?.trim() || code || "Property";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const image = property?.profile_image_url || property?.image_url;

  return (
    <div className="mb-6 flex min-w-0 flex-col items-center gap-3 px-1 text-center">
      {image ? (
        <img
          src={image}
          alt={`${name} profile`}
          width={64}
          height={64}
          className="h-16 w-16 shrink-0 rounded-full border border-sidebar-border bg-sidebar-accent object-cover"
        />
      ) : (
        <span
          aria-label={`${name} initials`}
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-sidebar-border bg-sidebar-accent text-lg font-bold"
        >
          {initials}
        </span>
      )}
      <div className="min-w-0 leading-tight">
        <p className="break-words text-sm font-bold">{name}</p>
      </div>
    </div>
  );
}
