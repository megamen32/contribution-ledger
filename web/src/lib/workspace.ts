import type { Prisma } from "@prisma/client"
import { JUDGE_MODELS } from "./omniroute"
import { subscriptionEnabled } from "./subscription"

export async function createWorkspace(tx: Prisma.TransactionClient, name: string) {
  const project = await tx.workspace.create({ data: { name } })
  await tx.ruleVersion.create({ data: {
    workspaceId: project.id, version: 1,
    contentJson: JSON.stringify({ summary: "Деньги и подтверждённый труд учитываются отдельно. Старания включены по умолчанию.", formulaText: "Неоплаченные часы × согласованная ставка + денежные вложения − выплаты", rounding: "Деньги хранятся в копейках", effortCredit: true }),
  } })
  await tx.modelProfile.create({ data: {
    workspaceId: project.id, profileId: subscriptionEnabled() ? "subscription-flash-v1" : "omniroute-v1", simulationMode: false,
    modelsJson: JSON.stringify(JUDGE_MODELS.map(key => ({ key, family: key.startsWith("glm") ? "GLM" : key.startsWith("MiniMax") ? "MiniMax" : "GPT", tag: key }))),
    seedsJson: "[1,2,3]", samplesPerModel: 3,
  } })
  return project
}
