import streamDeck from "@elgato/streamdeck";
import type { LogLevel } from "@elgato/utils/logging";
import { AgentKeyAction } from "./actions/agent-key.js";
import { ModelDialAction } from "./actions/model-dial.js";
import { EffortDialAction } from "./actions/effort-dial.js";
import { PermDialAction } from "./actions/perm-dial.js";
import { bridgeClient } from "./bridge-client.js";

// --- Register actions ---
const agentKeyAction = new AgentKeyAction();
const modelDialAction = new ModelDialAction();
const effortDialAction = new EffortDialAction();
const permDialAction = new PermDialAction();

streamDeck.actions.registerAction(agentKeyAction);
streamDeck.actions.registerAction(modelDialAction);
streamDeck.actions.registerAction(effortDialAction);
streamDeck.actions.registerAction(permDialAction);

// --- Re-render all on state change ---
bridgeClient.onChange(() => {
  agentKeyAction.renderAll();
  modelDialAction.updateAllFeedback();
  effortDialAction.updateAllFeedback();
  permDialAction.updateAllFeedback();
});

// --- Connect and start ---
const logLevel: LogLevel = "info";
streamDeck.logger.setLevel(logLevel);
bridgeClient.connect();
streamDeck.connect();
