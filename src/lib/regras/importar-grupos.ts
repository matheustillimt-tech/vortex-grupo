import { variantesTelefone } from "../telefone";

type GrupoLido = { amAdmin: boolean; participantCount: number; participants: { phone: string; isAdmin: boolean }[] };

/** Admin do grupo segundo o Zapbot: `amAdmin`, ou o número da conta (com e sem o nono dígito) entre os
 *  participantes admin. `amAdmin` do `GET groups` às vezes vem `false` com a conta admin (mesma checagem da troca de
 *  dono em `jobs/links.ts`). */
export function contaEhAdmin(g: GrupoLido, telefoneConta: string | null): boolean {
  if (g.amAdmin) return true;
  if (!telefoneConta) return false;
  const tels = new Set(variantesTelefone(telefoneConta));
  return g.participants.some((p) => p.isAdmin && tels.has(p.phone.split("@")[0]));
}

/** A lista (`GET groups`) não decide sozinha: sem `amAdmin` e sem participantes na resposta, só o `GET groups/{id}`
 *  diz se a conta é admin. Grupo sem ninguém (contagem 0) não vale a leitura. */
export function precisaLerGrupo(g: GrupoLido): boolean {
  return !g.amAdmin && g.participants.length === 0 && g.participantCount > 0;
}

/** Texto da tela quando não sobra grupo pra importar. `jaEmCampanha` = grupos em que a conta é admin mas que já
 *  estão numa campanha (esses se trazem com "Importar de: Campanha"). `naoLidos` = grupos que não deu tempo de
 *  conferir. */
export function mensagemSemImportaveis(jaEmCampanha: number, naoLidos: number): string {
  const partes = ["Nenhum grupo disponível para importar: nenhuma conexão da campanha é admin de um grupo fora do sistema."];
  if (jaEmCampanha > 0) partes.push(`${jaEmCampanha} grupo(s) em que a conexão é admin já estão em outra campanha: use "Importar de: Campanha" para movê-los.`);
  if (naoLidos > 0) partes.push(`${naoLidos} grupo(s) não puderam ser conferidos a tempo. Tente de novo.`);
  return partes.join(" ");
}
