import Link from "next/link";
import { Icone } from "./icone";
import { Pagina, Vazio, estiloBotao } from "./ui";

/** Tela de quem abre uma área sem "ver" (Etapa 2K). Só apresentação: quem decide é `bloqueio()` (./guarda). */
export function SemAcesso() {
  return (
    <Pagina titulo="Sem acesso">
      <Vazio
        icone={<Icone nome="lock" tamanho={16} />}
        texto="Você não tem acesso a esta área."
        acao={
          <Link href="/" className={estiloBotao("principal")}>
            Início
          </Link>
        }
      />
    </Pagina>
  );
}
