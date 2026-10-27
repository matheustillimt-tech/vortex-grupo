import { CarregandoTela } from "@/app/(painel)/_componentes/carregando";

/** Dentro do layout da campanha: o cabeçalho e as abas ficam, só o conteúdo da aba vira esqueleto. */
export default function CarregandoCampanha() {
  return <CarregandoTela comTitulo={false} />;
}
