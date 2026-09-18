import { redirect } from "next/navigation";

/** Ideas is a Tools card now, not a section — old links land on the grid. */
export default function IdeasPage() {
  redirect("/toolkit");
}
