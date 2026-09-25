import { redirect } from "next/navigation";

/** La vista de mapa pasó a ser la portada; mantenemos la URL antigua viva. */
export default function FavoritesRedirect() {
  redirect("/");
}
