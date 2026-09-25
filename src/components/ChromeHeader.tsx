import Nav from "./Nav";

/** Barra superior común a todas las vistas, incluida la del mapa. */
export default function ChromeHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/85 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/85">
      <Nav />
    </header>
  );
}
