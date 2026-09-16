import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const controlClasses =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-accent-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400";

export function Label({
  className = "",
  children,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label
      className={`mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400 ${className}`}
      {...rest}
    >
      {children}
    </label>
  );
}

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlClasses} h-9 ${className}`} {...rest} />;
}

export function TextArea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`${controlClasses} min-h-20 py-2 leading-relaxed ${className}`}
      {...rest}
    />
  );
}

export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={`${controlClasses} h-9 cursor-pointer ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint !== undefined ? (
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}
