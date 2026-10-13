import type { Prisma } from "@prisma/client"

export async function createWorkspace(tx: Prisma.TransactionClient, name: string) {
  const project = await tx.workspace.create({ data: { name } })
  await tx.ruleVersion.create({ data: {
    workspaceId: project.id, version: 1,
    contentJson: JSON.stringify({ summary: "Деньги и подтверждённый труд учитываются отдельно. Старания включены по умолчанию.", formulaText: "Неоплаченные часы × согласованная ставка + денежные вложения − выплаты", rounding: "Деньги хранятся в копейках", effortCredit: true }),
  } })
  await tx.modelProfile.create({ data: {
    workspaceId: project.id, profileId: "omniroute-v1", simulationMode: false,
    modelsJson: JSON.stringify([{ key: "glm-5.3", family: "GLM", tag: "glm-5.3" }, { key: "gpt-6", family: "GPT", tag: "gpt-6" }]),
    seedsJson: "[1,2,3]", samplesPerModel: 3,
  } })
  return project
}
