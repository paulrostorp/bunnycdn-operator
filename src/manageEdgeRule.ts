import { isBunnyAPIErrorPayload, PullZoneNotReadyError } from "./utils/misc";
import { CustomObjectsApi } from "@kubernetes/client-node";
import { getPullZoneCrStatusId } from "./managePullZone";
import { backOff } from "exponential-backoff";
import axios, { AxiosResponse } from "axios";
import { bunnyAPIHeaders } from "./operator";
import { EdgeRule } from "./types";
import { logger } from "./logger";

interface ApiEdgeRule {
  Guid?: string;
  ActionType: number;
  ActionParameter1?: string;
  ActionParameter2?: string;
  Triggers: {
    Type: number;
    PatternMatches?: string[];
    PatternMatchingType: number;
    Parameter1?: string;
  }[];
  TriggerMatchingType: number;
  Description?: string;
  Enabled: boolean;
}

export const upsertEdgeRule = async (pullZoneId: number, rule: ApiEdgeRule): Promise<Required<ApiEdgeRule>> => {
  try {
    const res = await axios.post<ApiEdgeRule, AxiosResponse<Required<ApiEdgeRule>>, ApiEdgeRule>(
      `https://api.bunny.net/pullzone/${pullZoneId}/edgerules/addOrUpdate`,
      rule,
      { headers: bunnyAPIHeaders }
    );
    return res.data;
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const data = e.response?.data;
      if (isBunnyAPIErrorPayload(data)) throw new Error(data.Message);
    }
    throw e;
  }
};

const getPullZoneId = async (object: EdgeRule, customObjectsAPIClient: CustomObjectsApi): Promise<number> => {
  const { spec, metadata } = object;

  const { name, namespace = metadata.namespace } = spec.pullZoneRef;

  const id = await backOff(() => getPullZoneCrStatusId(name, namespace, customObjectsAPIClient), {
    retry: (e, attempt) => {
      if (e instanceof PullZoneNotReadyError) {
        logger.debug("Pull zone not ready, retrying...", { attempt });
        return true;
      } else {
        logger.error("Pull zone was not ready after 5 attempt, giving up...", { attempt });
        return false;
      }
    },
    numOfAttempts: 5,
    startingDelay: 2000,
  });
  return id;
};

type IEdgeRuleCreationStatus =
  | { ready: true; message: ""; id: string; pullZoneId: number }
  | { ready: false; message: string; id?: never; pullZoneId?: never };

export const handleEdgeRuleModification = async (
  object: EdgeRule,
  customObjectsAPIClient: CustomObjectsApi
): Promise<IEdgeRuleCreationStatus> => {
  try {
    const { spec, status } = object;

    const pullZoneId = await getPullZoneId(object, customObjectsAPIClient);

    const { Guid } = await upsertEdgeRule(pullZoneId, {
      Guid: status?.id,
      ActionType: spec.actionType,
      ActionParameter1: spec.actionParameter1,
      ActionParameter2: spec.actionParameter2,
      Triggers: spec.triggers.map(t => ({
        Type: t.type,
        PatternMatches: t.patternMatches,
        PatternMatchingType: t.patternMatchingType,
        Parameter1: t.parameter1,
      })),
      TriggerMatchingType: spec.triggerMatchingType,
      Description: spec.description,
      Enabled: spec.enabled,
    });

    return { ready: true, message: "", id: Guid, pullZoneId };
  } catch (e) {
    return { ready: false, message: e instanceof Error ? e.message : "Unknown" };
  }
};

export const deleteEdgeRule = async (id: string, pullZoneId: number): Promise<void> => {
  await axios.delete<ApiEdgeRule>(`https://api.bunny.net/pullzone/${pullZoneId}/edgerules/${id}`, { headers: bunnyAPIHeaders });
};
