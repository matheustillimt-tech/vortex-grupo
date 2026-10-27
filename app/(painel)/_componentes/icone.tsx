/** Ícone Material (cheio), pelo nome da ligadura: https://fonts.google.com/icons?icon.set=Material+Icons */
export function Icone({ nome, className = "", tamanho = 20 }: { nome: string; className?: string; tamanho?: number }) {
  return (
    <span aria-hidden className={`material-icons shrink-0 ${className}`} style={{ fontSize: tamanho }}>
      {nome}
    </span>
  );
}
