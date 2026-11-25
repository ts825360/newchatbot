"use client";

import { useEffect, useId, useRef, type Ref } from "react";

export function TransportText({ label, value, onCommit, options, listId, maxLength = 120, disabled, invalid, placeholder, inputRef }: {
  label: string;
  value: string;
  onCommit: (value: string) => void | boolean;
  options?: string[];
  listId?: string;
  maxLength?: number;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.value = value; }, [value]);
  return <>
    <input ref={(node) => {
      ref.current = node;
      if (typeof inputRef === "function") inputRef(node);
      else if (inputRef) inputRef.current = node;
    }} type="text" aria-label={label} defaultValue={value} placeholder={placeholder} list={listId ?? (options ? id : undefined)} maxLength={maxLength} disabled={disabled} aria-invalid={invalid || undefined}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim();
        e.currentTarget.value = next !== value && onCommit(next) === false ? value : next;
      }} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur(); }} />
    {options && <datalist id={id}>{options.map((option) => <option key={option} value={option} />)}</datalist>}
  </>;
}
