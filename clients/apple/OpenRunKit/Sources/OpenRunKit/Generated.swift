//
// GENERATED — do not edit.
//
// Every operation here comes from `src/contract/operations.ts`. Change the
// descriptor and run `pnpm contract:generate`; editing this file by hand is
// undone by the next run and fails the `contract drift` check in CI.

import Foundation

/// Every operation the server offers, as one enum.
///
/// The raw value is the wire id, so a new server build can add operations
/// without this app changing — an id it has never heard of simply is not a
/// case here.
public enum Operation: String, CaseIterable, Sendable {
    case cloudStatus = "cloud.status"
    case cloudStartLogin = "cloud.startLogin"
    case cloudCompleteLogin = "cloud.completeLogin"
    /// Which providers this control plane can connect. Public — no session needed.
    case cloudProviders = "cloud.providers"
    case cloudSkipOnboarding = "cloud.skipOnboarding"
    case cloudSignOut = "cloud.signOut"
    case cloudStartHostedConnect = "cloud.startHostedConnect"
    case cloudCompleteHostedConnect = "cloud.completeHostedConnect"
    case cloudListHostedConnections = "cloud.listHostedConnections"
    case dashboardDashboard = "dashboard.dashboard"
    case devicesMobileStatus = "devices.mobileStatus"
    case devicesCreatePairingCode = "devices.createPairingCode"
    case devicesCancelPairing = "devices.cancelPairing"
    case devicesRevoke = "devices.revoke"
    case devicesRemove = "devices.remove"
    case filesListWorkspace = "files.listWorkspace"
    case filesReadWorkspace = "files.readWorkspace"
    case filesWriteWorkspace = "files.writeWorkspace"
    case filesRestoreWorkspace = "files.restoreWorkspace"
    /// Upload a composer image; `data` is raw base64 without the data-URL prefix.
    case filesSaveAttachment = "files.saveAttachment"
    case gitGetFileDiff = "git.getFileDiff"
    case gitCommitChanges = "git.commitChanges"
    case gitPushChanges = "git.pushChanges"
    case gitDiscardChanges = "git.discardChanges"
    case gitDiscardHunk = "git.discardHunk"
    case gitCreateBranch = "git.createBranch"
    case gitOpenPullRequest = "git.openPullRequest"
    case gitShipRun = "git.shipRun"
    case gitListProjectBranches = "git.listProjectBranches"
    case integrationsListProviders = "integrations.listProviders"
    case integrationsList = "integrations.list"
    case integrationsGet = "integrations.get"
    case integrationsCreate = "integrations.create"
    case integrationsUpdate = "integrations.update"
    case integrationsListWebhookDeliveries = "integrations.listWebhookDeliveries"
    case integrationsGetAutomationSetupContext = "integrations.getAutomationSetupContext"
    /// Bind a connected integration to a workspace + runtime so deliveries run.
    case integrationsCreateAutomation = "integrations.createAutomation"
    case integrationsDisconnectHosted = "integrations.disconnectHosted"
    case integrationsIngestTestEvent = "integrations.ingestTestEvent"
    case mcpGetConfig = "mcp.getConfig"
    case mcpSaveServer = "mcp.saveServer"
    case mcpRemoveServer = "mcp.removeServer"
    case mcpGetShared = "mcp.getShared"
    case mcpSaveSharedServer = "mcp.saveSharedServer"
    case mcpRemoveSharedServer = "mcp.removeSharedServer"
    case mcpDiscoverServers = "mcp.discoverServers"
    case mcpImportServers = "mcp.importServers"
    case mcpGetOAuthStatus = "mcp.getOAuthStatus"
    case mcpStartOAuth = "mcp.startOAuth"
    case mcpDisconnectServer = "mcp.disconnectServer"
    case mcpSyncShared = "mcp.syncShared"
    case notificationsListNotifiers = "notifications.listNotifiers"
    case notificationsSaveNotifier = "notifications.saveNotifier"
    case notificationsRemoveNotifier = "notifications.removeNotifier"
    case notificationsTestNotifier = "notifications.testNotifier"
    case notificationsListDeliveries = "notifications.listDeliveries"
    case plannerPlanObjective = "planner.planObjective"
    case plannerInstallPlanProposal = "planner.installPlanProposal"
    case pluginsList = "plugins.list"
    case pluginsListInstalled = "plugins.listInstalled"
    case projectsList = "projects.list"
    case projectsListLocalDirectories = "projects.listLocalDirectories"
    case projectsListLocalPlaces = "projects.listLocalPlaces"
    case projectsCreateLocalFolder = "projects.createLocalFolder"
    case projectsAdd = "projects.add"
    case projectsUpdate = "projects.update"
    /// Checks Open Run would propose for this repo, from its package.json scripts.
    case projectsSuggestChecks = "projects.suggestChecks"
    case projectsRemove = "projects.remove"
    case runsListNativeSessions = "runs.listNativeSessions"
    case runsList = "runs.list"
    case runsListConversationNavigation = "runs.listConversationNavigation"
    case runsCount = "runs.count"
    case runsListChecks = "runs.listChecks"
    case runsReRunChecks = "runs.reRunChecks"
    case runsGet = "runs.get"
    case runsCancel = "runs.cancel"
    case runsMarkRead = "runs.markRead"
    case runsRemove = "runs.remove"
    case runsDelete = "runs.delete"
    case runsGetLatestForWorkspace = "runs.getLatestForWorkspace"
    case runsGetLatestForProject = "runs.getLatestForProject"
    case runsStartOptions = "runs.startOptions"
    case runsStartChat = "runs.startChat"
    case runsOpenNativeChat = "runs.openNativeChat"
    case runsGetConversation = "runs.getConversation"
    case runsGetWorkspace = "runs.getWorkspace"
    case runsGetPullRequest = "runs.getPullRequest"
    case runsPostMessage = "runs.postMessage"
    /// Drop one follow-up waiting on the current turn.
    case runsDequeueMessage = "runs.dequeueMessage"
    /// Drop every follow-up waiting on a run.
    case runsClearQueuedMessages = "runs.clearQueuedMessages"
    /// Deliver the next queued follow-up on a run that is no longer working.
    case runsFlushQueuedMessages = "runs.flushQueuedMessages"
    /// Answer a pending tool-approval on a supervised run (allow/deny). The run detail UI calls this from the approval prompt; unanswered requests auto-deny on a timeout in the executor.
    case runsAnswerApproval = "runs.answerApproval"
    case runtimesList = "runtimes.list"
    case runtimesListPresetBins = "runtimes.listPresetBins"
    case runtimesSave = "runtimes.save"
    /// Resolve the exact argv a runtime draft would spawn — no run row, no process. POST because the Runtimes editor previews an unsaved template.
    case runtimesPreviewCommand = "runtimes.previewCommand"
    /// Same preview for a saved runtime, by id (tooling / non-UI callers).
    case runtimesPreviewCommandFor = "runtimes.previewCommandFor"
    case runtimesRemove = "runtimes.remove"
    case slashListCommands = "slash.listCommands"
    case tasksList = "tasks.list"
    case tasksGet = "tasks.get"
    case tasksSave = "tasks.save"
    case tasksSaveWebhook = "tasks.saveWebhook"
    case tasksToggle = "tasks.toggle"
    case tasksRemove = "tasks.remove"
    case tasksDelete = "tasks.delete"
    case tasksRunNow = "tasks.runNow"
    case tasksIsolateWorkspace = "tasks.isolateWorkspace"
    case tasksRestoreWorkspace = "tasks.restoreWorkspace"
    case tasksClearWorkspaceQuarantine = "tasks.clearWorkspaceQuarantine"
    case tasksListRunningIds = "tasks.listRunningIds"
    case tasksCreatesFromPlan = "tasks.createsFromPlan"
    case usageReport = "usage.report"
    case usagePressure = "usage.pressure"
    case workspacesRestore = "workspaces.restore"
    case workspacesRunBaseline = "workspaces.runBaseline"
    case workspacesList = "workspaces.list"
    case workspacesCreate = "workspaces.create"
    case workspacesRetrySetup = "workspaces.retrySetup"
    case workspacesArchive = "workspaces.archive"

    /// Where and how to reach this operation.
    public var route: Route {
        switch self {
        case .cloudStatus: return Route(method: "GET", path: "/api/v1/cloud/status", capability: "cloud.status", clients: ["web", "desktop"])
        case .cloudStartLogin: return Route(method: "POST", path: "/api/v1/cloud/start-login", capability: "cloud.startLogin", clients: ["web", "desktop"])
        case .cloudCompleteLogin: return Route(method: "POST", path: "/api/v1/cloud/complete-login", capability: "cloud.completeLogin", clients: ["web", "desktop"])
        case .cloudProviders: return Route(method: "GET", path: "/api/v1/cloud/providers", capability: "cloud.providers", clients: ["web", "desktop"])
        case .cloudSkipOnboarding: return Route(method: "POST", path: "/api/v1/cloud/skip-onboarding", capability: "cloud.skipOnboarding", clients: ["web", "desktop"])
        case .cloudSignOut: return Route(method: "POST", path: "/api/v1/cloud/sign-out", capability: "cloud.signOut", clients: ["web", "desktop"])
        case .cloudStartHostedConnect: return Route(method: "POST", path: "/api/v1/cloud/start-hosted-connect", capability: "cloud.startHostedConnect", clients: ["web", "desktop"])
        case .cloudCompleteHostedConnect: return Route(method: "POST", path: "/api/v1/cloud/complete-hosted-connect", capability: "cloud.completeHostedConnect", clients: ["web", "desktop"])
        case .cloudListHostedConnections: return Route(method: "GET", path: "/api/v1/cloud/list-hosted-connections", capability: "cloud.listHostedConnections", clients: ["web", "desktop"])
        case .dashboardDashboard: return Route(method: "GET", path: "/api/v1/dashboard/dashboard", capability: "dashboard", clients: ["web", "desktop", "mobile"])
        case .devicesMobileStatus: return Route(method: "GET", path: "/api/v1/devices/mobile-status", capability: "devices.mobileStatus", clients: ["web", "desktop"])
        case .devicesCreatePairingCode: return Route(method: "POST", path: "/api/v1/devices/create-pairing-code", capability: "devices.createPairingCode", clients: ["web", "desktop"])
        case .devicesCancelPairing: return Route(method: "POST", path: "/api/v1/devices/cancel-pairing", capability: "devices.cancelPairing", clients: ["web", "desktop"])
        case .devicesRevoke: return Route(method: "POST", path: "/api/v1/devices/revoke", capability: "devices.revoke", clients: ["web", "desktop"])
        case .devicesRemove: return Route(method: "POST", path: "/api/v1/devices/remove", capability: "devices.remove", clients: ["web", "desktop"])
        case .filesListWorkspace: return Route(method: "GET", path: "/api/v1/files/list-workspace", capability: "runs.files", clients: ["web", "desktop", "mobile"])
        case .filesReadWorkspace: return Route(method: "GET", path: "/api/v1/files/read-workspace", capability: "runs.files", clients: ["web", "desktop", "mobile"])
        case .filesWriteWorkspace: return Route(method: "POST", path: "/api/v1/files/write-workspace", capability: "files.writeWorkspace", clients: ["web", "desktop"])
        case .filesRestoreWorkspace: return Route(method: "POST", path: "/api/v1/files/restore-workspace", capability: "files.restoreWorkspace", clients: ["web", "desktop"])
        case .filesSaveAttachment: return Route(method: "POST", path: "/api/v1/files/save-attachment", capability: "files.saveAttachment", clients: ["web", "desktop"])
        case .gitGetFileDiff: return Route(method: "GET", path: "/api/v1/git/get-file-diff", capability: "runs.diff", clients: ["web", "desktop", "mobile"])
        case .gitCommitChanges: return Route(method: "POST", path: "/api/v1/git/commit-changes", capability: "git.commitChanges", clients: ["web", "desktop"])
        case .gitPushChanges: return Route(method: "POST", path: "/api/v1/git/push-changes", capability: "git.pushChanges", clients: ["web", "desktop"])
        case .gitDiscardChanges: return Route(method: "POST", path: "/api/v1/git/discard-changes", capability: "git.discardChanges", clients: ["web", "desktop"])
        case .gitDiscardHunk: return Route(method: "POST", path: "/api/v1/git/discard-hunk", capability: "git.discardHunk", clients: ["web", "desktop"])
        case .gitCreateBranch: return Route(method: "POST", path: "/api/v1/git/create-branch", capability: "git.createBranch", clients: ["web", "desktop"])
        case .gitOpenPullRequest: return Route(method: "POST", path: "/api/v1/git/open-pull-request", capability: "git.openPullRequest", clients: ["web", "desktop"])
        case .gitShipRun: return Route(method: "POST", path: "/api/v1/git/ship-run", capability: "git.shipRun", clients: ["web", "desktop"])
        case .gitListProjectBranches: return Route(method: "GET", path: "/api/v1/git/list-project-branches", capability: "git.listProjectBranches", clients: ["web", "desktop"])
        case .integrationsListProviders: return Route(method: "GET", path: "/api/v1/integrations/list-providers", capability: "integrations.listProviders", clients: ["web", "desktop"])
        case .integrationsList: return Route(method: "GET", path: "/api/v1/integrations/list", capability: "integrations.list", clients: ["web", "desktop"])
        case .integrationsGet: return Route(method: "GET", path: "/api/v1/integrations/get", capability: "integrations.get", clients: ["web", "desktop"])
        case .integrationsCreate: return Route(method: "POST", path: "/api/v1/integrations/create", capability: "integrations.create", clients: ["web", "desktop"])
        case .integrationsUpdate: return Route(method: "POST", path: "/api/v1/integrations/update", capability: "integrations.update", clients: ["web", "desktop"])
        case .integrationsListWebhookDeliveries: return Route(method: "GET", path: "/api/v1/integrations/list-webhook-deliveries", capability: "integrations.listWebhookDeliveries", clients: ["web", "desktop"])
        case .integrationsGetAutomationSetupContext: return Route(method: "GET", path: "/api/v1/integrations/get-automation-setup-context", capability: "integrations.getAutomationSetupContext", clients: ["web", "desktop"])
        case .integrationsCreateAutomation: return Route(method: "POST", path: "/api/v1/integrations/create-automation", capability: "integrations.createAutomation", clients: ["web", "desktop"])
        case .integrationsDisconnectHosted: return Route(method: "POST", path: "/api/v1/integrations/disconnect-hosted", capability: "integrations.disconnectHosted", clients: ["web", "desktop"])
        case .integrationsIngestTestEvent: return Route(method: "POST", path: "/api/v1/integrations/ingest-test-event", capability: "integrations.ingestTestEvent", clients: ["web", "desktop"])
        case .mcpGetConfig: return Route(method: "GET", path: "/api/v1/mcp/get-config", capability: "mcp.getConfig", clients: ["web", "desktop"])
        case .mcpSaveServer: return Route(method: "POST", path: "/api/v1/mcp/save-server", capability: "mcp.saveServer", clients: ["web", "desktop"])
        case .mcpRemoveServer: return Route(method: "POST", path: "/api/v1/mcp/remove-server", capability: "mcp.removeServer", clients: ["web", "desktop"])
        case .mcpGetShared: return Route(method: "GET", path: "/api/v1/mcp/get-shared", capability: "mcp.getShared", clients: ["web", "desktop"])
        case .mcpSaveSharedServer: return Route(method: "POST", path: "/api/v1/mcp/save-shared-server", capability: "mcp.saveSharedServer", clients: ["web", "desktop"])
        case .mcpRemoveSharedServer: return Route(method: "POST", path: "/api/v1/mcp/remove-shared-server", capability: "mcp.removeSharedServer", clients: ["web", "desktop"])
        case .mcpDiscoverServers: return Route(method: "GET", path: "/api/v1/mcp/discover-servers", capability: "mcp.discoverServers", clients: ["web", "desktop"])
        case .mcpImportServers: return Route(method: "POST", path: "/api/v1/mcp/import-servers", capability: "mcp.importServers", clients: ["web", "desktop"])
        case .mcpGetOAuthStatus: return Route(method: "GET", path: "/api/v1/mcp/get-oauth-status", capability: "mcp.getOAuthStatus", clients: ["web", "desktop"])
        case .mcpStartOAuth: return Route(method: "POST", path: "/api/v1/mcp/start-oauth", capability: "mcp.startOAuth", clients: ["web", "desktop"])
        case .mcpDisconnectServer: return Route(method: "POST", path: "/api/v1/mcp/disconnect-server", capability: "mcp.disconnectServer", clients: ["web", "desktop"])
        case .mcpSyncShared: return Route(method: "POST", path: "/api/v1/mcp/sync-shared", capability: "mcp.syncShared", clients: ["web", "desktop"])
        case .notificationsListNotifiers: return Route(method: "GET", path: "/api/v1/notifications/list-notifiers", capability: "notifications.listNotifiers", clients: ["web", "desktop"])
        case .notificationsSaveNotifier: return Route(method: "POST", path: "/api/v1/notifications/save-notifier", capability: "notifications.saveNotifier", clients: ["web", "desktop"])
        case .notificationsRemoveNotifier: return Route(method: "POST", path: "/api/v1/notifications/remove-notifier", capability: "notifications.removeNotifier", clients: ["web", "desktop"])
        case .notificationsTestNotifier: return Route(method: "POST", path: "/api/v1/notifications/test-notifier", capability: "notifications.testNotifier", clients: ["web", "desktop"])
        case .notificationsListDeliveries: return Route(method: "GET", path: "/api/v1/notifications/list-deliveries", capability: "notifications.listDeliveries", clients: ["web", "desktop"])
        case .plannerPlanObjective: return Route(method: "POST", path: "/api/v1/planner/plan-objective", capability: "planner.planObjective", clients: ["web", "desktop"])
        case .plannerInstallPlanProposal: return Route(method: "POST", path: "/api/v1/planner/install-plan-proposal", capability: "planner.installPlanProposal", clients: ["web", "desktop"])
        case .pluginsList: return Route(method: "GET", path: "/api/v1/plugins/list", capability: "plugins.list", clients: ["web", "desktop"])
        case .pluginsListInstalled: return Route(method: "GET", path: "/api/v1/plugins/list-installed", capability: "plugins.listInstalled", clients: ["web", "desktop"])
        case .projectsList: return Route(method: "GET", path: "/api/v1/projects/list", capability: "projects.list", clients: ["web", "desktop"])
        case .projectsListLocalDirectories: return Route(method: "GET", path: "/api/v1/projects/list-local-directories", capability: "projects.listLocalDirectories", clients: ["web", "desktop"])
        case .projectsListLocalPlaces: return Route(method: "GET", path: "/api/v1/projects/list-local-places", capability: "projects.listLocalPlaces", clients: ["web", "desktop"])
        case .projectsCreateLocalFolder: return Route(method: "POST", path: "/api/v1/projects/create-local-folder", capability: "projects.createLocalFolder", clients: ["web", "desktop"])
        case .projectsAdd: return Route(method: "POST", path: "/api/v1/projects/add", capability: "projects.add", clients: ["web", "desktop"])
        case .projectsUpdate: return Route(method: "POST", path: "/api/v1/projects/update", capability: "projects.update", clients: ["web", "desktop"])
        case .projectsSuggestChecks: return Route(method: "POST", path: "/api/v1/projects/suggest-checks", capability: "projects.suggestChecks", clients: ["web", "desktop"])
        case .projectsRemove: return Route(method: "POST", path: "/api/v1/projects/remove", capability: "projects.remove", clients: ["web", "desktop"])
        case .runsListNativeSessions: return Route(method: "GET", path: "/api/v1/runs/list-native-sessions", capability: "runs.listNativeSessions", clients: ["web", "desktop"])
        case .runsList: return Route(method: "GET", path: "/api/v1/runs/list", capability: "runs.list", clients: ["web", "desktop", "mobile"])
        case .runsListConversationNavigation: return Route(method: "GET", path: "/api/v1/runs/list-conversation-navigation", capability: "runs.listConversationNavigation", clients: ["web", "desktop"])
        case .runsCount: return Route(method: "GET", path: "/api/v1/runs/count", capability: "runs.count", clients: ["web", "desktop"])
        case .runsListChecks: return Route(method: "GET", path: "/api/v1/runs/list-checks", capability: "runs.listChecks", clients: ["web", "desktop"])
        case .runsReRunChecks: return Route(method: "POST", path: "/api/v1/runs/re-run-checks", capability: "runs.reRunChecks", clients: ["web", "desktop"])
        case .runsGet: return Route(method: "GET", path: "/api/v1/runs/get", capability: "runs.read", clients: ["web", "desktop", "mobile"])
        case .runsCancel: return Route(method: "POST", path: "/api/v1/runs/cancel", capability: "runs.cancel", clients: ["web", "desktop", "mobile"])
        case .runsMarkRead: return Route(method: "POST", path: "/api/v1/runs/mark-read", capability: "runs.markRead", clients: ["web", "desktop"])
        case .runsRemove: return Route(method: "POST", path: "/api/v1/runs/remove", capability: "runs.remove", clients: ["web", "desktop"])
        case .runsDelete: return Route(method: "POST", path: "/api/v1/runs/delete", capability: "runs.delete", clients: ["web", "desktop"])
        case .runsGetLatestForWorkspace: return Route(method: "GET", path: "/api/v1/runs/get-latest-for-workspace", capability: "runs.getLatestForWorkspace", clients: ["web", "desktop"])
        case .runsGetLatestForProject: return Route(method: "GET", path: "/api/v1/runs/get-latest-for-project", capability: "runs.getLatestForProject", clients: ["web", "desktop"])
        case .runsStartOptions: return Route(method: "GET", path: "/api/v1/runs/start-options", capability: "runs.startOptions", clients: ["web", "desktop", "mobile"])
        case .runsStartChat: return Route(method: "POST", path: "/api/v1/runs/start-chat", capability: "runs.create", clients: ["web", "desktop", "mobile"])
        case .runsOpenNativeChat: return Route(method: "POST", path: "/api/v1/runs/open-native-chat", capability: "runs.openNativeChat", clients: ["web", "desktop"])
        case .runsGetConversation: return Route(method: "GET", path: "/api/v1/runs/get-conversation", capability: "runs.read", clients: ["web", "desktop", "mobile"])
        case .runsGetWorkspace: return Route(method: "GET", path: "/api/v1/runs/get-workspace", capability: "runs.diff", clients: ["web", "desktop", "mobile"])
        case .runsGetPullRequest: return Route(method: "GET", path: "/api/v1/runs/get-pull-request", capability: "runs.getPullRequest", clients: ["web", "desktop"])
        case .runsPostMessage: return Route(method: "POST", path: "/api/v1/runs/post-message", capability: "runs.message", clients: ["web", "desktop", "mobile"])
        case .runsDequeueMessage: return Route(method: "POST", path: "/api/v1/runs/dequeue-message", capability: "runs.dequeueMessage", clients: ["web", "desktop"])
        case .runsClearQueuedMessages: return Route(method: "POST", path: "/api/v1/runs/clear-queued-messages", capability: "runs.clearQueuedMessages", clients: ["web", "desktop"])
        case .runsFlushQueuedMessages: return Route(method: "POST", path: "/api/v1/runs/flush-queued-messages", capability: "runs.flushQueuedMessages", clients: ["web", "desktop"])
        case .runsAnswerApproval: return Route(method: "POST", path: "/api/v1/runs/answer-approval", capability: "approvals.answer", clients: ["web", "desktop", "mobile"])
        case .runtimesList: return Route(method: "GET", path: "/api/v1/runtimes/list", capability: "runtimes.list", clients: ["web", "desktop"])
        case .runtimesListPresetBins: return Route(method: "GET", path: "/api/v1/runtimes/list-preset-bins", capability: "runtimes.listPresetBins", clients: ["web", "desktop"])
        case .runtimesSave: return Route(method: "POST", path: "/api/v1/runtimes/save", capability: "runtimes.save", clients: ["web", "desktop"])
        case .runtimesPreviewCommand: return Route(method: "POST", path: "/api/v1/runtimes/preview-command", capability: "runtimes.previewCommand", clients: ["web", "desktop"])
        case .runtimesPreviewCommandFor: return Route(method: "POST", path: "/api/v1/runtimes/preview-command-for", capability: "runtimes.previewCommandFor", clients: ["web", "desktop"])
        case .runtimesRemove: return Route(method: "POST", path: "/api/v1/runtimes/remove", capability: "runtimes.remove", clients: ["web", "desktop"])
        case .slashListCommands: return Route(method: "GET", path: "/api/v1/slash/list-commands", capability: "slash.listCommands", clients: ["web", "desktop"])
        case .tasksList: return Route(method: "GET", path: "/api/v1/tasks/list", capability: "tasks.list", clients: ["web", "desktop", "mobile"])
        case .tasksGet: return Route(method: "GET", path: "/api/v1/tasks/get", capability: "tasks.get", clients: ["web", "desktop"])
        case .tasksSave: return Route(method: "POST", path: "/api/v1/tasks/save", capability: "tasks.save", clients: ["web", "desktop"])
        case .tasksSaveWebhook: return Route(method: "POST", path: "/api/v1/tasks/save-webhook", capability: "tasks.saveWebhook", clients: ["web", "desktop"])
        case .tasksToggle: return Route(method: "POST", path: "/api/v1/tasks/toggle", capability: "tasks.toggle", clients: ["web", "desktop", "mobile"])
        case .tasksRemove: return Route(method: "POST", path: "/api/v1/tasks/remove", capability: "tasks.remove", clients: ["web", "desktop"])
        case .tasksDelete: return Route(method: "POST", path: "/api/v1/tasks/delete", capability: "tasks.delete", clients: ["web", "desktop"])
        case .tasksRunNow: return Route(method: "POST", path: "/api/v1/tasks/run-now", capability: "tasks.runNow", clients: ["web", "desktop", "mobile"])
        case .tasksIsolateWorkspace: return Route(method: "POST", path: "/api/v1/tasks/isolate-workspace", capability: "tasks.isolateWorkspace", clients: ["web", "desktop"])
        case .tasksRestoreWorkspace: return Route(method: "POST", path: "/api/v1/tasks/restore-workspace", capability: "tasks.restoreWorkspace", clients: ["web", "desktop"])
        case .tasksClearWorkspaceQuarantine: return Route(method: "POST", path: "/api/v1/tasks/clear-workspace-quarantine", capability: "tasks.clearWorkspaceQuarantine", clients: ["web", "desktop"])
        case .tasksListRunningIds: return Route(method: "GET", path: "/api/v1/tasks/list-running-ids", capability: "tasks.listRunningIds", clients: ["web", "desktop"])
        case .tasksCreatesFromPlan: return Route(method: "POST", path: "/api/v1/tasks/creates-from-plan", capability: "tasks.createsFromPlan", clients: ["web", "desktop"])
        case .usageReport: return Route(method: "GET", path: "/api/v1/usage/report", capability: "usage.report", clients: ["web", "desktop"])
        case .usagePressure: return Route(method: "GET", path: "/api/v1/usage/pressure", capability: "usage.pressure", clients: ["web", "desktop"])
        case .workspacesRestore: return Route(method: "POST", path: "/api/v1/workspaces/restore", capability: "workspaces.restore", clients: ["web", "desktop"])
        case .workspacesRunBaseline: return Route(method: "POST", path: "/api/v1/workspaces/run-baseline", capability: "workspaces.runBaseline", clients: ["web", "desktop"])
        case .workspacesList: return Route(method: "GET", path: "/api/v1/workspaces/list", capability: "workspaces.list", clients: ["web", "desktop"])
        case .workspacesCreate: return Route(method: "POST", path: "/api/v1/workspaces/create", capability: "workspaces.create", clients: ["web", "desktop"])
        case .workspacesRetrySetup: return Route(method: "POST", path: "/api/v1/workspaces/retry-setup", capability: "workspaces.retrySetup", clients: ["web", "desktop"])
        case .workspacesArchive: return Route(method: "POST", path: "/api/v1/workspaces/archive", capability: "workspaces.archive", clients: ["web", "desktop"])
        }
    }
}

/// Method, path and the permission an operation needs.
public struct Route: Sendable {
    public let method: String
    public let path: String
    public let capability: String
    public let clients: [String]
}

/// The versioned prefix every route sits under.
public let apiPrefix = "/api/v1"

/// How often the server heartbeats an SSE stream, in seconds.
///
/// Generated from `SERVER_PING_MS` in `src/lib/liveStream.ts`. Do not restate
/// it here — the web client learned the hard way that a second copy of this
/// number drifts, and `SSEClient` derives its watchdog from these two values.
public let serverPingInterval: TimeInterval = 15

/// Silence past this means the socket is dead even if the OS disagrees.
public let staleAfter: TimeInterval = 40

// MARK: - Request payloads

public struct CloudStartLoginRequest: Encodable, Sendable {
    public var origin: String
    public var next: String?

    public init(origin: String, next: String? = nil) {
        self.origin = origin
        self.next = next
    }
}

public struct CloudCompleteLoginRequest: Encodable, Sendable {
    public var code: String
    public var state: String

    public init(code: String, state: String) {
        self.code = code
        self.state = state
    }
}

public struct CloudStartHostedConnectRequest: Encodable, Sendable {
    public var provider: String
    public var origin: String

    public init(provider: String, origin: String) {
        self.provider = provider
        self.origin = origin
    }
}

public struct CloudCompleteHostedConnectRequest: Encodable, Sendable {
    public var provider: String
    public var cloudConnectionId: String
    public var state: String?
    public var siteUrl: String?
    public var accountName: String?

    public init(provider: String, cloudConnectionId: String, state: String? = nil, siteUrl: String? = nil, accountName: String? = nil) {
        self.provider = provider
        self.cloudConnectionId = cloudConnectionId
        self.state = state
        self.siteUrl = siteUrl
        self.accountName = accountName
    }
}

public struct DevicesCancelPairingRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct DevicesRevokeRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct DevicesRemoveRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct FilesListWorkspaceRequest: Encodable, Sendable {
    public var runId: String
    public var dir: String?

    public init(runId: String, dir: String? = nil) {
        self.runId = runId
        self.dir = dir
    }
}

public struct FilesReadWorkspaceRequest: Encodable, Sendable {
    public var runId: String
    public var path: String

    public init(runId: String, path: String) {
        self.runId = runId
        self.path = path
    }
}

public struct FilesWriteWorkspaceRequest: Encodable, Sendable {
    public var runId: String
    public var path: String
    public var content: String

    public init(runId: String, path: String, content: String) {
        self.runId = runId
        self.path = path
        self.content = content
    }
}

public struct FilesRestoreWorkspaceRequest: Encodable, Sendable {
    public var runId: String
    public var path: String
    public var content: String

    public init(runId: String, path: String, content: String) {
        self.runId = runId
        self.path = path
        self.content = content
    }
}

/// Upload a composer image; `data` is raw base64 without the data-URL prefix.
public struct FilesSaveAttachmentRequest: Encodable, Sendable {
    public var workspaceId: String
    public var name: String
    public var mimeType: String
    public var data: String

    public init(workspaceId: String, name: String, mimeType: String, data: String) {
        self.workspaceId = workspaceId
        self.name = name
        self.mimeType = mimeType
        self.data = data
    }
}

public struct GitGetFileDiffRequest: Encodable, Sendable {
    public var runId: String
    public var path: String
    public var whole: Bool?

    public init(runId: String, path: String, whole: Bool? = nil) {
        self.runId = runId
        self.path = path
        self.whole = whole
    }
}

public struct GitCommitChangesRequest: Encodable, Sendable {
    public var runId: String
    public var message: String
    public var paths: [String]?

    public init(runId: String, message: String, paths: [String]? = nil) {
        self.runId = runId
        self.message = message
        self.paths = paths
    }
}

public struct GitPushChangesRequest: Encodable, Sendable {
    public var runId: String

    public init(runId: String) {
        self.runId = runId
    }
}

public struct GitDiscardChangesRequest: Encodable, Sendable {
    public var runId: String
    public var paths: [String]?
    public var resetCommits: Bool?

    public init(runId: String, paths: [String]? = nil, resetCommits: Bool? = nil) {
        self.runId = runId
        self.paths = paths
        self.resetCommits = resetCommits
    }
}

public struct GitDiscardHunkRequest: Encodable, Sendable {
    public var runId: String
    public var path: String
    public var hunkIndex: Double

    public init(runId: String, path: String, hunkIndex: Double) {
        self.runId = runId
        self.path = path
        self.hunkIndex = hunkIndex
    }
}

public struct GitCreateBranchRequest: Encodable, Sendable {
    public var runId: String
    public var name: String

    public init(runId: String, name: String) {
        self.runId = runId
        self.name = name
    }
}

public struct GitOpenPullRequestRequest: Encodable, Sendable {
    public var runId: String
    public var title: String
    public var body: String
    public var base: String?

    public init(runId: String, title: String, body: String, base: String? = nil) {
        self.runId = runId
        self.title = title
        self.body = body
        self.base = base
    }
}

public struct GitShipRunRequest: Encodable, Sendable {
    public var runId: String
    public var base: String?
    public var skipPlan: Bool?

    public init(runId: String, base: String? = nil, skipPlan: Bool? = nil) {
        self.runId = runId
        self.base = base
        self.skipPlan = skipPlan
    }
}

public struct GitListProjectBranchesRequest: Encodable, Sendable {
    public var projectId: String

    public init(projectId: String) {
        self.projectId = projectId
    }
}

public struct IntegrationsGetRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct IntegrationsCreateRequest: Encodable, Sendable {
    public var provider: String

    public init(provider: String) {
        self.provider = provider
    }
}

public struct IntegrationsUpdateRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct IntegrationsListWebhookDeliveriesRequest: Encodable, Sendable {
    public var integrationId: String?
    public var limit: Double?

    public init(integrationId: String? = nil, limit: Double? = nil) {
        self.integrationId = integrationId
        self.limit = limit
    }
}

/// Bind a connected integration to a workspace + runtime so deliveries run.
public struct IntegrationsCreateAutomationRequest: Encodable, Sendable {
    public var integrationId: String
    public var workspaceId: String
    public var runtimeId: String
    public var trigger: JSONValue?
    public var events: [String]?
    public var name: String?
    public var prompt: String?
    public var enabled: Bool?

    public init(integrationId: String, workspaceId: String, runtimeId: String, trigger: JSONValue? = nil, events: [String]? = nil, name: String? = nil, prompt: String? = nil, enabled: Bool? = nil) {
        self.integrationId = integrationId
        self.workspaceId = workspaceId
        self.runtimeId = runtimeId
        self.trigger = trigger
        self.events = events
        self.name = name
        self.prompt = prompt
        self.enabled = enabled
    }
}

public struct IntegrationsDisconnectHostedRequest: Encodable, Sendable {
    public var integrationId: String

    public init(integrationId: String) {
        self.integrationId = integrationId
    }
}

public struct IntegrationsIngestTestEventRequest: Encodable, Sendable {
    public var integrationId: String

    public init(integrationId: String) {
        self.integrationId = integrationId
    }
}

public struct McpGetConfigRequest: Encodable, Sendable {
    public var runtimeId: String
    public var workspaceId: String?

    public init(runtimeId: String, workspaceId: String? = nil) {
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
    }
}

public struct McpSaveServerRequest: Encodable, Sendable {
    public var runtimeId: String
    public var workspaceId: String?
    public var targetId: String
    public var server: JSONValue
    public var previousName: String?

    public init(runtimeId: String, workspaceId: String? = nil, targetId: String, server: JSONValue, previousName: String? = nil) {
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
        self.targetId = targetId
        self.server = server
        self.previousName = previousName
    }
}

public struct McpRemoveServerRequest: Encodable, Sendable {
    public var runtimeId: String
    public var workspaceId: String?
    public var targetId: String
    public var name: String

    public init(runtimeId: String, workspaceId: String? = nil, targetId: String, name: String) {
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
        self.targetId = targetId
        self.name = name
    }
}

public struct McpSaveSharedServerRequest: Encodable, Sendable {
    public var server: JSONValue
    public var previousName: String?
    public var force: Bool?

    public init(server: JSONValue, previousName: String? = nil, force: Bool? = nil) {
        self.server = server
        self.previousName = previousName
        self.force = force
    }
}

public struct McpRemoveSharedServerRequest: Encodable, Sendable {
    public var name: String
    public var scope: String?

    public init(name: String, scope: String? = nil) {
        self.name = name
        self.scope = scope
    }
}

public struct McpImportServersRequest: Encodable, Sendable {
    public var choices: [JSONValue]

    public init(choices: [JSONValue]) {
        self.choices = choices
    }
}

public struct McpStartOAuthRequest: Encodable, Sendable {
    public var name: String
    public var redirectUri: String

    public init(name: String, redirectUri: String) {
        self.name = name
        self.redirectUri = redirectUri
    }
}

public struct McpDisconnectServerRequest: Encodable, Sendable {
    public var name: String

    public init(name: String) {
        self.name = name
    }
}

public struct McpSyncSharedRequest: Encodable, Sendable {
    public var force: Bool?

    public init(force: Bool? = nil) {
        self.force = force
    }
}

public struct NotificationsSaveNotifierRequest: Encodable, Sendable {
    public var kind: String
    public var name: String
    public var target: String?
    public var enabled: Bool

    public init(kind: String, name: String, target: String? = nil, enabled: Bool) {
        self.kind = kind
        self.name = name
        self.target = target
        self.enabled = enabled
    }
}

public struct NotificationsRemoveNotifierRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct NotificationsTestNotifierRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct NotificationsListDeliveriesRequest: Encodable, Sendable {
    public var notifierId: String?
    public var limit: Double?

    public init(notifierId: String? = nil, limit: Double? = nil) {
        self.notifierId = notifierId
        self.limit = limit
    }
}

public struct PlannerPlanObjectiveRequest: Encodable, Sendable {
    public var objective: String
    public var runtimeId: String
    public var workspaceId: String

    public init(objective: String, runtimeId: String, workspaceId: String) {
        self.objective = objective
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
    }
}

public struct PlannerInstallPlanProposalRequest: Encodable, Sendable {
    public var runtimeId: String
    public var workspaceId: String
    public var proposal: JSONValue
    public var enabled: Bool?

    public init(runtimeId: String, workspaceId: String, proposal: JSONValue, enabled: Bool? = nil) {
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
        self.proposal = proposal
        self.enabled = enabled
    }
}

public struct PluginsListRequest: Encodable, Sendable {
    public var runtimeId: String
    public var workspaceId: String?

    public init(runtimeId: String, workspaceId: String? = nil) {
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
    }
}

public struct PluginsListInstalledRequest: Encodable, Sendable {
    public var workspaceId: String?

    public init(workspaceId: String? = nil) {
        self.workspaceId = workspaceId
    }
}

public struct ProjectsListLocalDirectoriesRequest: Encodable, Sendable {
    public var dir: String?
    public var showHidden: Bool?

    public init(dir: String? = nil, showHidden: Bool? = nil) {
        self.dir = dir
        self.showHidden = showHidden
    }
}

public struct ProjectsCreateLocalFolderRequest: Encodable, Sendable {
    public var parent: String?
    public var name: String

    public init(parent: String? = nil, name: String) {
        self.parent = parent
        self.name = name
    }
}

public struct ProjectsAddRequest: Encodable, Sendable {
    public var mode: String
    public var url: String?
    public var path: String?
    public var name: String?
    public var setupCommand: String?

    public init(mode: String, url: String? = nil, path: String? = nil, name: String? = nil, setupCommand: String? = nil) {
        self.mode = mode
        self.url = url
        self.path = path
        self.name = name
        self.setupCommand = setupCommand
    }
}

public struct ProjectsUpdateRequest: Encodable, Sendable {
    public var id: String
    public var name: String?
    public var setupCommand: String?
    public var defaultBranch: String?
    public var checks: [JSONValue]?

    public init(id: String, name: String? = nil, setupCommand: String? = nil, defaultBranch: String? = nil, checks: [JSONValue]? = nil) {
        self.id = id
        self.name = name
        self.setupCommand = setupCommand
        self.defaultBranch = defaultBranch
        self.checks = checks
    }
}

/// Checks Open Run would propose for this repo, from its package.json scripts.
public struct ProjectsSuggestChecksRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct ProjectsRemoveRequest: Encodable, Sendable {
    public var id: String
    public var deleteFiles: Bool

    public init(id: String, deleteFiles: Bool) {
        self.id = id
        self.deleteFiles = deleteFiles
    }
}

public struct RunsListNativeSessionsRequest: Encodable, Sendable {
    public var workspaceId: String?
    public var allWorkspaces: Bool?
    public var kind: String?
    public var offset: Double?
    public var limit: Double?

    public init(workspaceId: String? = nil, allWorkspaces: Bool? = nil, kind: String? = nil, offset: Double? = nil, limit: Double? = nil) {
        self.workspaceId = workspaceId
        self.allWorkspaces = allWorkspaces
        self.kind = kind
        self.offset = offset
        self.limit = limit
    }
}

public struct RunsListRequest: Encodable, Sendable {
    public var taskId: String?
    public var limit: Double?
    public var offset: Double?
    public var includeArchived: Bool?

    public init(taskId: String? = nil, limit: Double? = nil, offset: Double? = nil, includeArchived: Bool? = nil) {
        self.taskId = taskId
        self.limit = limit
        self.offset = offset
        self.includeArchived = includeArchived
    }
}

public struct RunsCountRequest: Encodable, Sendable {
    public var taskId: String?
    public var includeArchived: Bool?

    public init(taskId: String? = nil, includeArchived: Bool? = nil) {
        self.taskId = taskId
        self.includeArchived = includeArchived
    }
}

public struct RunsListChecksRequest: Encodable, Sendable {
    public var runId: String

    public init(runId: String) {
        self.runId = runId
    }
}

public struct RunsReRunChecksRequest: Encodable, Sendable {
    public var runId: String

    public init(runId: String) {
        self.runId = runId
    }
}

public struct RunsGetRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct RunsCancelRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct RunsMarkReadRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct RunsRemoveRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct RunsDeleteRequest: Encodable, Sendable {
    public var ids: [String]

    public init(ids: [String]) {
        self.ids = ids
    }
}

public struct RunsGetLatestForWorkspaceRequest: Encodable, Sendable {
    public var workspaceId: String

    public init(workspaceId: String) {
        self.workspaceId = workspaceId
    }
}

public struct RunsGetLatestForProjectRequest: Encodable, Sendable {
    public var projectId: String

    public init(projectId: String) {
        self.projectId = projectId
    }
}

public struct RunsStartChatRequest: Encodable, Sendable {
    public var workspaceId: String
    public var runtimeId: String
    public var prompt: String
    public var model: String?
    public var effort: String?
    public var runtimeMode: String?
    public var resumeSessionId: String?
    public var resumeSessionLabel: String?

    public init(workspaceId: String, runtimeId: String, prompt: String, model: String? = nil, effort: String? = nil, runtimeMode: String? = nil, resumeSessionId: String? = nil, resumeSessionLabel: String? = nil) {
        self.workspaceId = workspaceId
        self.runtimeId = runtimeId
        self.prompt = prompt
        self.model = model
        self.effort = effort
        self.runtimeMode = runtimeMode
        self.resumeSessionId = resumeSessionId
        self.resumeSessionLabel = resumeSessionLabel
    }
}

public struct RunsOpenNativeChatRequest: Encodable, Sendable {
    public var workspaceId: String
    public var runtimeId: String
    public var sessionId: String
    public var sessionLabel: String?
    public var model: String?
    public var effort: String?
    public var runtimeMode: String?

    public init(workspaceId: String, runtimeId: String, sessionId: String, sessionLabel: String? = nil, model: String? = nil, effort: String? = nil, runtimeMode: String? = nil) {
        self.workspaceId = workspaceId
        self.runtimeId = runtimeId
        self.sessionId = sessionId
        self.sessionLabel = sessionLabel
        self.model = model
        self.effort = effort
        self.runtimeMode = runtimeMode
    }
}

public struct RunsGetConversationRequest: Encodable, Sendable {
    public var runId: String

    public init(runId: String) {
        self.runId = runId
    }
}

public struct RunsGetWorkspaceRequest: Encodable, Sendable {
    public var runId: String

    public init(runId: String) {
        self.runId = runId
    }
}

public struct RunsGetPullRequestRequest: Encodable, Sendable {
    public var runId: String

    public init(runId: String) {
        self.runId = runId
    }
}

public struct RunsPostMessageRequest: Encodable, Sendable {
    public var runId: String
    public var prompt: String
    public var runtimeId: String?
    public var model: String?
    public var effort: String?
    public var runtimeMode: String?
    public var userMessageId: String?
    public var assistantMessageId: String?
    public var force: Bool?

    public init(runId: String, prompt: String, runtimeId: String? = nil, model: String? = nil, effort: String? = nil, runtimeMode: String? = nil, userMessageId: String? = nil, assistantMessageId: String? = nil, force: Bool? = nil) {
        self.runId = runId
        self.prompt = prompt
        self.runtimeId = runtimeId
        self.model = model
        self.effort = effort
        self.runtimeMode = runtimeMode
        self.userMessageId = userMessageId
        self.assistantMessageId = assistantMessageId
        self.force = force
    }
}

/// Drop one follow-up waiting on the current turn.
public struct RunsDequeueMessageRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

/// Drop every follow-up waiting on a run.
public struct RunsClearQueuedMessagesRequest: Encodable, Sendable {
    public var runId: String

    public init(runId: String) {
        self.runId = runId
    }
}

/// Deliver the next queued follow-up on a run that is no longer working.
public struct RunsFlushQueuedMessagesRequest: Encodable, Sendable {
    public var runId: String

    public init(runId: String) {
        self.runId = runId
    }
}

/// Answer a pending tool-approval on a supervised run (allow/deny). The run detail UI calls this from the approval prompt; unanswered requests auto-deny on a timeout in the executor.
public struct RunsAnswerApprovalRequest: Encodable, Sendable {
    public var runId: String
    public var requestId: String
    public var optionId: String?
    public var decision: String?
    public var message: String?

    public init(runId: String, requestId: String, optionId: String? = nil, decision: String? = nil, message: String? = nil) {
        self.runId = runId
        self.requestId = requestId
        self.optionId = optionId
        self.decision = decision
        self.message = message
    }
}

public struct RuntimesSaveRequest: Encodable, Sendable {
    public var label: String?
    public var bin: String?

    public init(label: String? = nil, bin: String? = nil) {
        self.label = label
        self.bin = bin
    }
}

/// Resolve the exact argv a runtime draft would spawn — no run row, no process. POST because the Runtimes editor previews an unsaved template.
public struct RuntimesPreviewCommandRequest: Encodable, Sendable {
    public var runtimeId: String?
    public var bin: String?

    public init(runtimeId: String? = nil, bin: String? = nil) {
        self.runtimeId = runtimeId
        self.bin = bin
    }
}

/// Same preview for a saved runtime, by id (tooling / non-UI callers).
public struct RuntimesPreviewCommandForRequest: Encodable, Sendable {
    public var runtimeId: String
    public var workspaceId: String?
    public var model: String?
    public var effort: String?
    public var runtimeMode: String?
    public var isFollowUp: Bool?

    public init(runtimeId: String, workspaceId: String? = nil, model: String? = nil, effort: String? = nil, runtimeMode: String? = nil, isFollowUp: Bool? = nil) {
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
        self.model = model
        self.effort = effort
        self.runtimeMode = runtimeMode
        self.isFollowUp = isFollowUp
    }
}

public struct RuntimesRemoveRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct SlashListCommandsRequest: Encodable, Sendable {
    public var runtimeId: String
    public var workspaceId: String?
    public var includeApp: Bool?

    public init(runtimeId: String, workspaceId: String? = nil, includeApp: Bool? = nil) {
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
        self.includeApp = includeApp
    }
}

public struct TasksGetRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct TasksSaveRequest: Encodable, Sendable {
    public var name: String?
    public var runtimeId: String?
    public var prompt: String?

    public init(name: String? = nil, runtimeId: String? = nil, prompt: String? = nil) {
        self.name = name
        self.runtimeId = runtimeId
        self.prompt = prompt
    }
}

public struct TasksSaveWebhookRequest: Encodable, Sendable {
    public var taskId: String
    public var webhookIntegrationId: String?
    public var webhookEvents: [String]?
    public var webhookFilters: JSONValue?

    public init(taskId: String, webhookIntegrationId: String? = nil, webhookEvents: [String]? = nil, webhookFilters: JSONValue? = nil) {
        self.taskId = taskId
        self.webhookIntegrationId = webhookIntegrationId
        self.webhookEvents = webhookEvents
        self.webhookFilters = webhookFilters
    }
}

public struct TasksToggleRequest: Encodable, Sendable {
    public var id: String
    public var enabled: Bool

    public init(id: String, enabled: Bool) {
        self.id = id
        self.enabled = enabled
    }
}

public struct TasksRemoveRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct TasksDeleteRequest: Encodable, Sendable {
    public var ids: [String]

    public init(ids: [String]) {
        self.ids = ids
    }
}

public struct TasksRunNowRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct TasksIsolateWorkspaceRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct TasksRestoreWorkspaceRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct TasksClearWorkspaceQuarantineRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct TasksCreatesFromPlanRequest: Encodable, Sendable {
    public var runtimeId: String
    public var workspaceId: String
    public var proposals: [JSONValue]
    public var enabled: Bool?

    public init(runtimeId: String, workspaceId: String, proposals: [JSONValue], enabled: Bool? = nil) {
        self.runtimeId = runtimeId
        self.workspaceId = workspaceId
        self.proposals = proposals
        self.enabled = enabled
    }
}

public struct UsageReportRequest: Encodable, Sendable {
    public var range: String?

    public init(range: String? = nil) {
        self.range = range
    }
}

public struct WorkspacesRestoreRequest: Encodable, Sendable {
    public var workspaceId: String

    public init(workspaceId: String) {
        self.workspaceId = workspaceId
    }
}

public struct WorkspacesRunBaselineRequest: Encodable, Sendable {
    public var workspaceId: String

    public init(workspaceId: String) {
        self.workspaceId = workspaceId
    }
}

public struct WorkspacesListRequest: Encodable, Sendable {
    public var projectId: String?

    public init(projectId: String? = nil) {
        self.projectId = projectId
    }
}

public struct WorkspacesCreateRequest: Encodable, Sendable {
    public var projectId: String
    public var branch: String
    public var fromBranch: String?
    public var useExistingBranch: Bool?

    public init(projectId: String, branch: String, fromBranch: String? = nil, useExistingBranch: Bool? = nil) {
        self.projectId = projectId
        self.branch = branch
        self.fromBranch = fromBranch
        self.useExistingBranch = useExistingBranch
    }
}

public struct WorkspacesRetrySetupRequest: Encodable, Sendable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct WorkspacesArchiveRequest: Encodable, Sendable {
    public var id: String
    public var force: Bool

    public init(id: String, force: Bool) {
        self.id = id
        self.force = force
    }
}
