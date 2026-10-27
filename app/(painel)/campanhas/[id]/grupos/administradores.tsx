"use client";
import { Icone } from "../../../_componentes/icone";
import { Botao, estiloInput, Vazio } from "../../../_componentes/ui";
import { campoDeTelefoneSalvo, mascaraTelefoneBr, MAXIMO_ADMINS_NUMEROS, normalizarTelefoneAdmin } from "@/src/lib/regras/admins-numeros";
import { telefoneLegivel, variantesTelefone } from "@/src/lib/telefone";

export type ContaParaAdmin = { id: string; nome: string; telefone: string | null; status: string };

/**
 * Aba "Administradores" dos diálogos "Criação de grupos" / "Alterar grupos em lote" (Etapa 3E, Tarefa 3):
 * números admin da campanha (`campanha_conexoes`). A conta criadora não aparece na lista — ela já administra os
 * grupos e nunca pode ser removida.
 */
export function AbaAdministradores({ contas, criadoraId, marcados, onChange }: {
  contas: ContaParaAdmin[];
  criadoraId: string | null;
  marcados: Set<string>;
  onChange: (marcados: Set<string>) => void;
}) {
  const disponiveis = contas.filter((c) => c.id !== criadoraId);
  const criadora = contas.find((c) => c.id === criadoraId);
  return (
    <div className="space-y-3">
      {criadora && (
        <p className="text-sm text-vg-text-2">
          <b className="font-medium text-vg-text">{criadora.nome}</b> cria os grupos desta campanha; não pode ser removida aqui.
        </p>
      )}
      {disponiveis.length === 0 ? (
        <Vazio texto="Nenhuma outra conexão conectada para administrar a campanha." compacto />
      ) : (
        <div className="space-y-1.5">
          {disponiveis.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={marcados.has(c.id)}
                onChange={(e) => {
                  const s = new Set(marcados);
                  if (e.target.checked) s.add(c.id);
                  else s.delete(c.id);
                  onChange(s);
                }}
              />
              {c.nome} {c.telefone ? `(${c.telefone})` : ""}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Um campo "Contato *" da lista de administradores por número (`chave` estável pro React). */
export type CampoAdminNumero = { chave: number; valor: string };

let proximaChave = 0;
/** Campos iniciais a partir dos telefones salvos (`campanha_admins_numeros`), já com a máscara. */
export function camposAdminsNumeros(telefones: string[]): CampoAdminNumero[] {
  return telefones.map((t) => ({ chave: ++proximaChave, valor: campoDeTelefoneSalvo(t) }));
}

/** Telefones salvos que não estão mais nos campos (com e sem o nono dígito contam como o mesmo). */
export function numerosTirados(iniciais: string[], campos: CampoAdminNumero[]): string[] {
  const atuais = new Set(
    campos.flatMap((c) => {
      const t = normalizarTelefoneAdmin(c.valor);
      return t ? variantesTelefone(t) : [];
    }),
  );
  return iniciais.filter((t) => !variantesTelefone(t).some((v) => atuais.has(v)));
}

/**
 * Aba "Administradores" completa (Etapa 3K, Tarefa 1): lista numerada de campos "Contato *" (telefone livre, com
 * máscara BR e `delete` em cada um), botão "NOVO ADMINISTRADOR" e, abaixo, "Administradores de contas associadas"
 * (as contas de sempre, `AbaAdministradores`). Com `rebaixar`/`aoRebaixar` (só em "Alterar grupos em lote"), cada
 * número salvo que saiu da lista mostra a caixa "Também remover como admin dos grupos existentes" (desmarcada).
 */
export function AbaAdministradoresComNumeros({ contas, criadoraId, marcados, onChange, campos, aoMudarCampos, iniciais, rebaixar, aoRebaixar, rotuloBotao = "NOVO ADMINISTRADOR" }: {
  contas: ContaParaAdmin[];
  criadoraId: string | null;
  marcados: Set<string>;
  onChange: (marcados: Set<string>) => void;
  campos: CampoAdminNumero[];
  aoMudarCampos: (campos: CampoAdminNumero[]) => void;
  iniciais: string[];
  rebaixar?: Set<string>;
  aoRebaixar?: (rebaixar: Set<string>) => void;
  /** Rótulo do botão `add` ("NOVO ADMINISTRADOR" nos diálogos de grupos; "Adicionar administrador" no Padrão de
   *  criação, Etapa 3K Tarefa 2 — mesmo componente). */
  rotuloBotao?: string;
}) {
  const tirados = rebaixar && aoRebaixar ? numerosTirados(iniciais, campos) : [];
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {campos.length === 0 && <p className="text-sm text-vg-text-3">Nenhum administrador por número.</p>}
        <ol className="space-y-2">
          {campos.map((c, i) => (
            <li key={c.chave} className="flex items-end gap-2">
              <span className="w-6 pb-2 text-right text-sm tabular-nums text-vg-text-3">{i + 1}.</span>
              <label className="block min-w-0 flex-1 space-y-1.5">
                <span className="text-[13.3px] text-[#e3e9e5]">Contato *</span>
                <input
                  className={estiloInput}
                  inputMode="tel"
                  placeholder="(11) 9 1234-5678"
                  value={c.valor}
                  onChange={(e) => aoMudarCampos(campos.map((x) => (x.chave === c.chave ? { ...x, valor: mascaraTelefoneBr(e.target.value) } : x)))}
                />
              </label>
              <button
                type="button"
                aria-label={`Remover contato ${i + 1}`}
                title="Remover"
                onClick={() => aoMudarCampos(campos.filter((x) => x.chave !== c.chave))}
                className="mb-1 rounded p-1 text-vg-text-3 hover:bg-white/5 hover:text-vg-erro"
              >
                <Icone nome="delete" />
              </button>
            </li>
          ))}
        </ol>
        <Botao
          type="button"
          variante="contorno"
          icone={<Icone nome="add" />}
          disabled={campos.length >= MAXIMO_ADMINS_NUMEROS}
          onClick={() => aoMudarCampos([...campos, { chave: ++proximaChave, valor: "" }])}
        >
          {rotuloBotao}
        </Botao>
      </div>

      {tirados.length > 0 && rebaixar && aoRebaixar && (
        <div className="space-y-2 rounded-lg border border-vg-line p-3">
          <p className="text-sm text-vg-text-2">Saíram da lista (continuam admin nos grupos existentes, a menos que você marque):</p>
          {tirados.map((t) => (
            <div key={t} className="space-y-1 text-sm">
              <p className="tabular-nums">{telefoneLegivel(t)}</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rebaixar.has(t)}
                  onChange={(e) => {
                    const s = new Set(rebaixar);
                    if (e.target.checked) s.add(t);
                    else s.delete(t);
                    aoRebaixar(s);
                  }}
                />
                Também remover como admin dos grupos existentes
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-vg-text">Administradores de conexões associadas</h3>
        <AbaAdministradores contas={contas} criadoraId={criadoraId} marcados={marcados} onChange={onChange} />
      </div>
    </div>
  );
}
