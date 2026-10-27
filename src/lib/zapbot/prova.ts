/** Resultado da prova com gente real (Task 1 do plano da Fase 2A, 15/10/2026, grupo TESTE #01 com 2 pessoas).
 *  Decide o plano completo ou o plano B das enquetes (fluxo 7) e da confirmação de entrega (fluxo 8).
 *  Enquete: send-poll no grupo funcionou e a pessoa votou, mas polls/{id}/results devolveu totalVoters 0
 *  (o Zapbot só apura votos que chegam como mensagem, e grupo não gera webhook de mensagem).
 *  Recibos: chegaram MessageStatusCallback RECEIVED e READ com isGroup true, participantPhone e ids contendo
 *  o messageId devolvido pelo send-text. O número também recebe recibos de mensagens que não são nossas
 *  (ids desconhecidos): ignorar. */
export const PROVA = {
  data: "2026-10-15",
  /** `polls/{messageId}/results` devolveu os votos das pessoas no grupo. */
  enqueteEmGrupo: false,
  /** Mostrado na tela no plano B. */
  enqueteMotivo: "O Zapbot ainda não devolve os votos de enquetes enviadas a grupos. Veja o resultado no WhatsApp.",
  /** Chegou `MessageStatusCallback` de mensagem enviada a grupo, com o mesmo id que o `send-text` devolveu. */
  recibosEmGrupo: true,
  recibosMotivo: "",
  /** `limit-sharing` num grupo de teste mudou a "Privacidade avançada da conversa" no aparelho (Etapa 3K). Enquanto
   *  `false`, a ação "Privacidade Avançada na Conversa" mostra o selo BETA e o motivo, mas pode ser usada. */
  privacidadeEmGrupo: false,
  privacidadeMotivo: "O Zapbot ainda não conferiu esta opção em grupos no aparelho.",
  /** O `GET groups/{id}` da conferência traz `avatarUrl`? (Etapa 3M) `null` = ainda não conferido: a foto real usa a
   *  regra "campo presente → usa; ausente → rota `groups/{id}/avatar` no máximo 1× a cada 24 h por grupo".
   *  Prova de 17/10/2026 (só leitura, uma conta com 28 grupos): `GET groups/{id}` traz `avatarUrl`
   *  `https://` no grupo com foto, com e sem `?participants=false` e `?inviteLink=false`; no grupo sem foto a chave
   *  NÃO vem (e `groups/{id}/avatar` devolve `avatarUrl` que não é `https://`). `GET groups` (lista) nunca traz
   *  `avatarUrl`. `groups/{id}/avatar` traz a URL no grupo com foto. */
  fotoNaConferencia: true as boolean | null,
} as const;
