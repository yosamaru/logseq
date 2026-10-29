(ns electron.skill-hub
  "Electron-owned Skill Hub lifecycle and native directory authorization."
  (:require ["electron" :refer [app dialog shell]]
            ["path" :as node-path]
            [cljs-bean.core :as bean]
            [electron.i18n :refer [t]]
            [logseq.common.defkeywords :refer [defkeyword]]
            [promesa.core :as p]))

(defkeyword :skill-hub/request "Dispatch a Skill Hub operation")
(defkeyword :skill-hub/directory "Authorize a directory through the native picker")
(defkeyword :skill-hub/reveal "Reveal an indexed Skill source in the file manager")

(defonce ^:private *runtime (atom nil))

(defn- ^js runtime! []
  (or @*runtime
      (let [module (js/require (node-path/join js/__dirname "js" "skill-hub.cjs"))
            runtime (new (.-DesktopHub module) (.getPath app "userData"))]
        (reset! *runtime runtime)
        runtime)))

(defn- failure []
  {:error {:code "DESKTOP" :message (t :skill-hub/error)}})

(defn- directory-failure [^js error]
  (if (contains? #{"CONFIG" "ADAPTER" "PATH" "LINK"} (.-code error))
    {:error {:code (.-code error) :message (.-message error)}}
    (failure)))

(defn <request [operation args & [graph-path]]
  ;; Always resolve an envelope: generic IPC rejection logging must never
  ;; receive an edited SKILL.md or another sensitive request body.
  (-> (p/resolved nil)
      (p/then (fn [_] (.request (runtime!) operation (bean/->js args) graph-path)))
      (p/then bean/->clj)
      (p/catch (fn [_] (failure)))))

(defn <directory [window {:keys [kind writable agent]}]
  (-> (p/let [^js selection (.showOpenDialog dialog window #js {:properties #js ["openDirectory"]})]
        (if (.-canceled selection)
          {:result {:cancelled true}}
          (p/let [selected (aget (.-filePaths selection) 0)
                  item (.authorizeDirectory (runtime!) kind selected #js {:writable writable :agent agent})]
            {:result (bean/->clj item)})))
      (p/catch directory-failure)))

(defn <reveal [id graph-path]
  (-> (p/let [response (<request "detail" {:id id} graph-path)]
        (if (:error response)
          response
          (do (.showItemInFolder shell (node-path/join (get-in response [:result :path]) "SKILL.md"))
              {:result true})))
      (p/catch (fn [_] (failure)))))
