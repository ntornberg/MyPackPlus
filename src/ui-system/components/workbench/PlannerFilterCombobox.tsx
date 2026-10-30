import { type ReactNode, useRef, useState } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

/** Base UI resets the filter text when the `items` array *reference* changes; callers often pass `Object.keys(...)` which is a new array every render. */
function useStableStringItems(items: string[]): string[] {
  const signature = items.join("\u0000");
  const cache = useRef<{ signature: string; items: string[] }>({
    signature: "",
    items: [],
  });
  if (cache.current.signature !== signature) {
    cache.current = { signature, items };
  }
  return cache.current.items;
}

type PlannerFilterComboboxProps = {
  id?: string;
  acceptOnTab?: boolean;
  items: string[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder: string;
  emptyLabel: string;
  disabled?: boolean;
  portalContainer: HTMLElement | null;
  /** Display text for an item when the stored value is not human-readable; also used for typed filtering. */
  itemLabel?: (item: string) => string;
  /** Custom option content; defaults to the label. */
  renderItem?: (item: string) => ReactNode;
};

export function PlannerFilterCombobox({
  id,
  acceptOnTab = false,
  items,
  value,
  onValueChange,
  placeholder,
  emptyLabel,
  disabled = false,
  portalContainer,
  itemLabel,
  renderItem,
}: PlannerFilterComboboxProps) {
  const stableItems = useStableStringItems(items);
  const [open, setOpen] = useState(false);
  const typed = useRef(false);
  const highlighted = useRef<string | undefined>(undefined);

  return (
    <Combobox
      items={stableItems}
      itemToStringLabel={itemLabel}
      value={value}
      onValueChange={(nextValue) => {
        typed.current = false;
        onValueChange(nextValue ?? null);
      }}
      open={open}
      onOpenChange={setOpen}
      onInputValueChange={(text, details) => {
        if (details.reason === "input-change")
          typed.current = Boolean(text.trim());
      }}
      onItemHighlighted={(item) => {
        highlighted.current = item;
      }}
      autoHighlight
    >
      <ComboboxInput
        id={id}
        onKeyDownCapture={(event) => {
          if (
            acceptOnTab &&
            event.key === "Tab" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            open &&
            typed.current &&
            highlighted.current &&
            stableItems.includes(highlighted.current)
          ) {
            typed.current = false;
            onValueChange(highlighted.current);
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        showClear={!disabled}
        className={
          value
            ? "h-auto w-full [&>input]:absolute [&>input]:inset-0 [&>input]:h-full [&>input]:pr-10 [&>input]:text-transparent [&>input:focus]:text-foreground [&>[data-slot=input-group-addon]]:relative"
            : "w-full"
        }
      >
        {value ? (
          <span
            aria-hidden="true"
            className="pointer-events-none order-first min-w-0 flex-1 break-words py-2 pl-2.5 text-sm leading-snug group-has-[input:focus]/input-group:invisible"
          >
            {itemLabel ? itemLabel(value) : value}
          </span>
        ) : null}
      </ComboboxInput>
      <ComboboxContent container={portalContainer}>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item} value={item}>
              {renderItem
                ? renderItem(item)
                : itemLabel
                  ? itemLabel(item)
                  : item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
