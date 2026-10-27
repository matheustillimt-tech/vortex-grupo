"use client";
import { Janela } from "./janela";
import { Botao } from "./ui";

/** Diálogo "Meu Perfil" (menu do usuário): só leitura, com os dados que a
 *  barra do topo já tem em mãos (nome, e-mail e papel). Sem tela de edição. */
export function MeuPerfil({ aberta, aoFechar, nome, email, papel }: {
  aberta: boolean;
  aoFechar: () => void;
  nome: string;
  email: string;
  papel: string;
}) {
  return (
    <Janela aberta={aberta} aoFechar={aoFechar} titulo="Meu Perfil" icone="account_circle">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-vg-text-3">Nome</dt>
          <dd className="mt-0.5 font-medium">{nome}</dd>
        </div>
        <div>
          <dt className="text-vg-text-3">E-mail</dt>
          <dd className="mt-0.5 font-medium">{email}</dd>
        </div>
        <div>
          <dt className="text-vg-text-3">Papel</dt>
          <dd className="mt-0.5 font-medium">{papel}</dd>
        </div>
      </dl>
      <div className="mt-5 flex justify-end">
        <Botao type="button" variante="secundario" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
    </Janela>
  );
}
