(ns frontend.components.skill-hub
  "Built-in desktop Skill Hub. The bundled view only receives narrow host capabilities."
  (:require [cljs-bean.core :as bean]
            [electron.ipc :as ipc]
            [frontend.context.i18n :refer [t]]
            [frontend.handler.route :as route-handler]
            [frontend.rfx :as rfx]
            [frontend.state :as state]
            [frontend.util :as util]
            [io.factorhouse.hsx.core :as hsx]
            [logseq.api.editor :as api-editor]
            [logseq.common.defkeywords :refer [defkeyword]]
            [logseq.shui.hooks :as hooks]
            [promesa.core :as p]))

(defkeyword :skill-hub "Built-in Skill management route")

(defn- translations []
  {
   "title" (t :skill-hub/title)
   "close" (t :skill-hub/close)
   "search" (t :skill-hub/search)
   "all" (t :skill-hub/all)
   "agent" (t :skill-hub/agent)
   "domain" (t :skill-hub/domain)
   "version" (t :skill-hub/version)
   "status" (t :skill-hub/status)
   "sort" (t :skill-hub/sort)
   "name" (t :skill-hub/name)
   "modified" (t :skill-hub/modified)
   "list" (t :skill-hub/list)
   "cards" (t :skill-hub/cards)
   "refresh" (t :skill-hub/refresh)
   "count" (t :skill-hub/count)
   "empty" (t :skill-hub/empty)
   "loading" (t :skill-hub/loading)
   "select" (t :skill-hub/select)
   "source" (t :skill-hub/source)
   "tags" (t :skill-hub/tags)
   "dependencies" (t :skill-hub/dependencies)
   "references" (t :skill-hub/references)
   "files" (t :skill-hub/files)
   "validation" (t :skill-hub/validation)
   "valid" (t :skill-hub/valid)
   "editor" (t :skill-hub/editor)
   "preview" (t :skill-hub/preview)
   "save" (t :skill-hub/save)
   "undo" (t :skill-hub/undo)
   "readonly" (t :skill-hub/readonly)
   "install" (t :skill-hub/install)
   "uninstall" (t :skill-hub/uninstall)
   "rollback" (t :skill-hub/rollback)
   "target" (t :skill-hub/target)
   "disk" (t :skill-hub/disk)
   "unknown" (t :skill-hub/unknown)
   "history" (t :skill-hub/history)
   "diff" (t :skill-hub/diff)
   "compare" (t :skill-hub/compare)
   "from" (t :skill-hub/from)
   "to" (t :skill-hub/to)
   "restore" (t :skill-hub/restore)
   "tag" (t :skill-hub/tag)
   "tagName" (t :skill-hub/tag-name)
   "confirm" (t :skill-hub/confirm)
   "cancel" (t :skill-hub/cancel)
   "plan" (t :skill-hub/plan)
   "before" (t :skill-hub/before)
   "after" (t :skill-hub/after)
   "changes" (t :skill-hub/changes)
   "expires" (t :skill-hub/expires)
   "noChanges" (t :skill-hub/no-changes)
   "link" (t :skill-hub/link)
   "pageName" (t :skill-hub/page-name)
   "linked" (t :skill-hub/linked)
   "draft" (t :skill-hub/draft)
   "draftName" (t :skill-hub/draft-name)
   "root" (t :skill-hub/root)
   "draftText" (t :skill-hub/draft-text)
   "draftPreview" (t :skill-hub/draft-preview)
   "draftHint" (t :skill-hub/draft-hint)
   "detect" (t :skill-hub/detect)
   "saved" (t :skill-hub/saved)
   "risk" (t :skill-hub/risk)
   "error" (t :skill-hub/error)
   "discarded" (t :skill-hub/discarded)
   "notInstalled" (t :skill-hub/not-installed)
   "invalid" (t :skill-hub/invalid)
   "notes" (t :skill-hub/notes)
   "noHistory" (t :skill-hub/no-history)
   "readFile" (t :skill-hub/read-file)
   "records" (t :skill-hub/records)
   "exportNote" (t :skill-hub/export-note)
   "missingNote" (t :skill-hub/missing-note)
   "schema" (t :skill-hub/schema)
   "restore-install" (t :skill-hub/restore-install)
   "addRoot" (t :skill-hub/add-root)
   "addTarget" (t :skill-hub/add-target)
   "rootWritable" (t :skill-hub/root-writable)
   "chooseDirectory" (t :skill-hub/choose-directory)
   "rootHint" (t :skill-hub/root-hint)
   "targetHint" (t :skill-hub/target-hint)
   "desktopOnly" (t :skill-hub/desktop-only)})

(defn- <editor-request [method args]
  (case method
    "getCurrentBlock" (api-editor/get_current_block #js {})
    "getPage" (api-editor/get_page (aget args 0))
    "createPage" (api-editor/create_page (aget args 0) (aget args 1) (aget args 2))
    "insertBlock" (api-editor/insert_block (aget args 0) (aget args 1) (aget args 2))
    (p/rejected (js/Error. (t :skill-hub/error)))))

(defn- <host-request [operation args]
  (case operation
    "startup" (p/let [note (api-editor/get_current_block #js {})]
                #js {:translations (bean/->js (translations)) :note note})
    "rpc" (ipc/ipc :skill-hub/request (.-operation args) (bean/->clj (.-args args)))
    "directory" (ipc/ipc :skill-hub/directory (bean/->clj args))
    "reveal" (ipc/ipc :skill-hub/reveal (.-id args))
    "editor" (<editor-request (.-method args) (.-args args))
    "close" (do (route-handler/redirect-to-home!) (p/resolved nil))
    (p/rejected (js/Error. (t :skill-hub/error)))))

(hsx/defc page
  []
  (let [frame (hooks/use-ref nil)
        locale (rfx/use-sub [:preferred-language])
        repo (state/get-current-repo)]
    (hooks/use-effect!
     (fn []
       (when (util/electron?)
         (let [origin (.-origin js/location)
               handler (fn [^js event]
                         (let [^js source (.-source event)
                               ^js data (.-data event)]
                           (when (and (= source (some-> (hooks/deref frame) .-contentWindow))
                                      (= origin (.-origin event))
                                      (= "logseq-skill-hub" (.-channel data)))
                             (let [reply (fn [payload]
                                           (.postMessage source
                                                         (bean/->js (merge {:channel "logseq-skill-hub"
                                                                          :id (.-id data)} payload))
                                                         origin))]
                               (-> (p/resolved nil)
                                   (p/then (fn [_] (<host-request (.-operation data) (.-args data))))
                                   (p/then (fn [result] (reply {:result result})))
                                   (p/catch (fn [_]
                                              (reply {:error {:message (t :skill-hub/error)}}))))))))]
           (.addEventListener js/window "message" handler)
           #(.removeEventListener js/window "message" handler))))
     [locale repo])
    (if (util/electron?)
      [:iframe.block.w-full.border-0
       {:key (str locale ":" repo)
        :ref frame
        :title (t :skill-hub/title)
        :src "./skill-hub/index.html"
        :style {:height "calc(100vh - 80px)"}}]
      [:div.p-8
       [:h1.text-xl.font-semibold (t :skill-hub/title)]
       [:p.mt-4 (t :skill-hub/desktop-only)]])))
