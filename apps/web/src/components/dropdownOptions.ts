/** One row of a `DropdownSelect`. Lives in a plain module so callers can import
 *  the type without reaching into the component's script block. */
export interface DropdownOption {
  value: string;
  label: string;
  /** A short explanation, used as the row's tooltip and the control's title. */
  hint?: string;
  disabled?: boolean;
}
