import {
  GraduationCapIcon,
  MoonStarIcon,
  SunMediumIcon,
  XIcon,
} from "lucide-react";
import React, {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import InstructorSearch from "../../course-management/components/search-tabs/InstructorSearch";
import {
  CourseSearchDataInitialState,
  GepSearchDataInitialState,
  MajorPlanSearchDataInitialState,
  restoredTerm,
  type CourseSearchData,
  type GepSearchData,
  type MajorPlanSearchData,
  type TabUpdater,
} from "../../course-management/components/tab-state/tabState";
import { refreshCart } from "../../course-management/services/refreshCart";
import {
  PLANNING_SYNCED_AT_KEY,
  syncPlanningData,
} from "../../degree-planning/services/planningSync";
import PlannerLauncherHint from "../../user-experience/components/UserGuide/PlannerLauncherHint";
import { StatusBanner } from "../../user-experience/status/StatusBanner";
import { UpdateReadyPill } from "../../user-experience/update/UpdateReadyNotice";

import {
  plannerActionButtonClassName,
  plannerDrawerContentClassName,
  plannerFloatingButtonClassName,
  plannerLauncherClassName,
  plannerOverlayClassName,
} from "./planner/plannerShellStyles";
import {
  flushPlannerSessionPersist,
  loadPersistedPlannerSession,
  loadPlannerSelectedTab,
  persistPlannerSelectedTab,
  schedulePlannerSessionPersist,
} from "./plannerSessionPersistence";
import { TabLoadingSkeleton } from "./shared/TabLoadingSkeleton";
import { PlannerPreviewRail } from "./workbench/PlannerPreviewRail";
import { useOverlayPortalContainer } from "./workbench/useOverlayPortalContainer";
import {
  type PlannerSectionPreview,
  type PlannerWorkbenchTab,
} from "./workbench/workbenchTypes";

const loadCourseSearch = () =>
  import("../../course-management/components/search-tabs/CourseSearch");
const loadGepSearch = () =>
  import("../../course-management/components/search-tabs/GepSearch");
const loadMajorPlanSearch = () =>
  import("../../course-management/components/search-tabs/MajorPlanSearch");
const CourseSearch = React.lazy(loadCourseSearch);
const GepSearch = React.lazy(loadGepSearch);
const MajorPlanSearch = React.lazy(loadMajorPlanSearch);

/**
 * Warms the caches for the term's likely courses. Imported on demand because
 * it pulls in the course catalog, which the launcher doesn't need.
 */
function prefetchLikelyCourses(term: string | null, { force = false } = {}) {
  if (!term) return;
  import("../../course-management/services/prefetch/prefetchLikelyCourses")
    .then(({ clearPrefetchThrottle, schedulePrefetch }) => {
      if (force) clearPrefetchThrottle(term);
      schedulePrefetch(term);
    })
    .catch(() => undefined);
}

const MemoizedCourseSearchTab = React.memo(
  ({
    setCourseSearchTabData,
    courseSearchData,
    onPreviewSectionChange,
    previewContent,
    selectedPreviewId,
  }: {
    setCourseSearchTabData: TabUpdater<CourseSearchData>;
    courseSearchData: CourseSearchData;
    onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
    previewContent: React.ReactNode;
    selectedPreviewId: string | null;
  }) => (
    <React.Suspense
      fallback={<TabLoadingSkeleton label="Loading course search…" />}
    >
      <CourseSearch
        setCourseSearchTabData={setCourseSearchTabData}
        courseSearchData={courseSearchData}
        onPreviewSectionChange={onPreviewSectionChange}
        previewContent={previewContent}
        selectedPreviewId={selectedPreviewId}
      />
    </React.Suspense>
  ),
);

const MemoizedGepSearchTab = React.memo(
  ({
    setGepSearchTabData,
    GepSearchData,
    onPreviewSectionChange,
    previewContent,
    selectedPreviewId,
    isActive,
  }: {
    setGepSearchTabData: TabUpdater<GepSearchData>;
    GepSearchData: GepSearchData;
    onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
    previewContent: React.ReactNode;
    selectedPreviewId: string | null;
    isActive: boolean;
  }) => (
    <React.Suspense
      fallback={<TabLoadingSkeleton label="Loading GEP search…" />}
    >
      <GepSearch
        isActive={isActive}
        setGepSearchTabData={setGepSearchTabData}
        GepSearchData={GepSearchData}
        onPreviewSectionChange={onPreviewSectionChange}
        previewContent={previewContent}
        selectedPreviewId={selectedPreviewId}
      />
    </React.Suspense>
  ),
);

const MemoizedMajorPlanSearchTab = React.memo(
  ({
    setMajorPlanSearchTabData,
    majorPlanSearchData,
    onPreviewSectionChange,
    previewContent,
    selectedPreviewId,
  }: {
    setMajorPlanSearchTabData: TabUpdater<MajorPlanSearchData>;
    majorPlanSearchData: MajorPlanSearchData;
    onPreviewSectionChange: (preview: PlannerSectionPreview | null) => void;
    previewContent: React.ReactNode;
    selectedPreviewId: string | null;
  }) => (
    <React.Suspense
      fallback={<TabLoadingSkeleton label="Loading major plan search…" />}
    >
      <MajorPlanSearch
        setMajorPlanSearchTabData={setMajorPlanSearchTabData}
        majorPlanSearchData={majorPlanSearchData}
        onPreviewSectionChange={onPreviewSectionChange}
        previewContent={previewContent}
        selectedPreviewId={selectedPreviewId}
      />
    </React.Suspense>
  ),
);

const PLANNER_TABS: PlannerWorkbenchTab[] = [
  "course_search",
  "gep_search",
  "major_plan_search",
  "instructor_search",
];

const MemoizedPlannerPreviewRail = React.memo(
  PlannerPreviewRail,
  (prev, next) =>
    prev.isOpen === next.isOpen &&
    prev.selectedPreview?.id === next.selectedPreview?.id,
);

function mergeCourseSearchData(
  stored: Partial<CourseSearchData> | undefined,
): CourseSearchData {
  const storedCourseInfo = stored?.selectedCourseInfo;

  return {
    ...CourseSearchDataInitialState,
    ...stored,
    selectedTerm: restoredTerm(stored?.selectedTerm),
    selectedCourseInfo:
      storedCourseInfo === null
        ? null
        : {
            code: storedCourseInfo?.code ?? null,
            catalogNum: storedCourseInfo?.catalogNum ?? null,
            title: storedCourseInfo?.title ?? null,
            id: storedCourseInfo?.id ?? "",
          },
  };
}

function mergeMajorPlanSearchData(
  stored: Partial<MajorPlanSearchData> | undefined,
): MajorPlanSearchData {
  const selectedTerm = restoredTerm(stored?.selectedTerm);
  // Saved results belong to the saved term; drop them if the term moved on.
  const termChanged =
    stored?.selectedTerm !== undefined && selectedTerm !== stored.selectedTerm;
  const restored = {
    ...MajorPlanSearchDataInitialState,
    ...stored,
    selectedTerm,
    openCourses:
      (termChanged ? undefined : stored?.openCourses) ??
      MajorPlanSearchDataInitialState.openCourses,
  };

  if (restored.isLoaded === false) {
    return {
      ...restored,
      isLoaded: true,
      progress: 0,
      progressLabel: "",
    };
  }

  return restored;
}

function mergeGepData(
  stored: Partial<GepSearchData> | undefined,
): GepSearchData {
  const selectedTerm = restoredTerm(stored?.selectedTerm);
  // Saved results belong to the saved term; drop them if the term moved on.
  const termChanged =
    stored?.selectedTerm !== undefined && selectedTerm !== stored.selectedTerm;
  const restored = {
    ...GepSearchDataInitialState,
    ...stored,
    selectedTerm,
    courseData:
      (termChanged ? undefined : stored?.courseData) ??
      GepSearchDataInitialState.courseData,
    courses:
      (termChanged ? undefined : stored?.courses) ??
      GepSearchDataInitialState.courses,
  };

  if (restored.isLoaded === false) {
    return {
      ...restored,
      isLoaded: true,
      progress: 0,
      progressLabel: "",
    };
  }

  return restored;
}

export default function SlideOutDrawer({
  showLauncherHint = true,
  defaultOpen = false,
}: {
  showLauncherHint?: boolean;
  /** Start with the planner open (staging screenshots). */
  defaultOpen?: boolean;
}) {
  const persisted = useMemo(
    () =>
      typeof window !== "undefined" ? loadPersistedPlannerSession() : null,
    [],
  );

  const [drawerOpen, setDrawerOpen] = useState(defaultOpen);
  // Once mounted the panel stays mounted, so reopening only runs the animation.
  // `parked`: closed and the exit animation has finished, so it isn't rendered.
  const [panelMounted, setPanelMounted] = useState(defaultOpen);
  const [parked, setParked] = useState(!defaultOpen);
  const [selectedTab, setSelectedTab] = useState<PlannerWorkbenchTab>(() => {
    const fromTabKey = loadPlannerSelectedTab();
    if (fromTabKey) {
      return fromTabKey;
    }
    return persisted?.selectedTab ?? "course_search";
  });
  // Only the tab in view mounts with the panel; the rest follow once it has opened.
  const [mountedTabs, setMountedTabs] = useState<
    ReadonlySet<PlannerWorkbenchTab>
  >(() => new Set([selectedTab]));
  const launcherRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectedPreview, setSelectedPreview] =
    useState<PlannerSectionPreview | null>(null);
  const [themeMode, setThemeMode] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    try {
      const saved = localStorage.getItem("mypack-theme-mode");
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      /* ignore */
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [courseSearchData, setCourseSearchData] = useState(() =>
    mergeCourseSearchData(persisted?.courseSearchData),
  );
  const [majorPlanSearchData, setMajorPlanSearchData] = useState(() =>
    mergeMajorPlanSearchData(persisted?.majorPlanSearchData),
  );
  const [GepSearchData, setGepSearchData] = useState(() =>
    mergeGepData(persisted?.GepSearchData),
  );
  const portalContainer = useOverlayPortalContainer();

  const setCourseSearchTabData: TabUpdater<CourseSearchData> = useCallback(
    (keyOrPatch, value) => {
      setCourseSearchData((prev) =>
        typeof keyOrPatch === "object"
          ? { ...prev, ...keyOrPatch }
          : { ...prev, [keyOrPatch]: value },
      );
    },
    [],
  );

  const setMajorPlanSearchTabData: TabUpdater<MajorPlanSearchData> =
    useCallback((keyOrPatch, value) => {
      if (typeof keyOrPatch === "object") {
        setMajorPlanSearchData((prev) => ({ ...prev, ...keyOrPatch }));
        return;
      }

      setMajorPlanSearchData((prev) => ({ ...prev, [keyOrPatch]: value }));
    }, []);

  const setGepSearchTabData: TabUpdater<GepSearchData> = useCallback(
    (keyOrPatch, value) => {
      setGepSearchData((prev) =>
        typeof keyOrPatch === "object"
          ? { ...prev, ...keyOrPatch }
          : { ...prev, [keyOrPatch]: value },
      );
    },
    [],
  );

  // Term of the tab in view (Instructor search has none; use Course search's).
  const activeTerm =
    selectedTab === "gep_search"
      ? GepSearchData.selectedTerm
      : selectedTab === "major_plan_search"
        ? majorPlanSearchData.selectedTerm
        : courseSearchData.selectedTerm;

  // First hover or focus on the launcher: load the tab code, refresh Pack
  // Planner and the audit (a no-op while the last sync is fresh), and mount the
  // closed panel so the first open doesn't pay for it mid-animation.
  const warmedUp = useRef(false);
  const warmUp = useCallback(() => {
    if (warmedUp.current) return;
    warmedUp.current = true;
    void Promise.all([
      loadCourseSearch(),
      loadGepSearch(),
      loadMajorPlanSearch(),
    ]).catch(() => undefined);
    void syncPlanningData().catch(() => undefined);
    startTransition(() => setPanelMounted(true));
  }, []);

  // While open, prefetch the term in view, and again once a planning sync
  // lands, since it can bring courses the first pass didn't know about.
  useEffect(() => {
    if (!drawerOpen) return;
    prefetchLikelyCourses(activeTerm);
    const onChanged =
      typeof chrome !== "undefined" ? chrome.storage?.onChanged : undefined;
    if (!onChanged) return;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (
        areaName === "local" &&
        typeof changes[PLANNING_SYNCED_AT_KEY]?.newValue === "number"
      ) {
        prefetchLikelyCourses(activeTerm, { force: true });
      }
    };
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  }, [drawerOpen, activeTerm]);

  const handleDrawerOpen = useCallback(() => {
    if (drawerOpen) {
      return;
    }
    setPanelMounted(true);
    setParked(false);
    setDrawerOpen(true);
  }, [drawerOpen]);

  // The session effect below saves the state, so closing only flips `open`.
  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  // The open animation has started, so the panel is visible and can take focus.
  const handlePanelAnimationStart = useCallback(
    (event: React.AnimationEvent<HTMLDivElement>) => {
      const content = event.currentTarget;
      if (!drawerOpen || event.target !== content) {
        return;
      }
      const root = content.getRootNode() as Document | ShadowRoot;
      if (!content.contains(root.activeElement)) {
        content.focus({ preventScroll: true });
      }
    },
    [drawerOpen],
  );

  // Work that would drop frames runs once the open or close animation is done.
  const handlePanelAnimationEnd = useCallback(
    (event: React.AnimationEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      if (!drawerOpen) {
        setParked(true);
        setSelectedPreview(null);
        return;
      }
      refreshCart();
      startTransition(() => setMountedTabs(new Set(PLANNER_TABS)));
    },
    [drawerOpen],
  );

  // A kept-mounted panel doesn't get Radix's focus moves. On close, send focus
  // back to the launcher (going inert drops the panel's focus to the body); on
  // reopen, handlePanelAnimationStart moves it in.
  const wasOpen = useRef(drawerOpen);
  useEffect(() => {
    const justClosed = wasOpen.current && !drawerOpen;
    wasOpen.current = drawerOpen;
    const content = contentRef.current;
    if (!justClosed || !content) {
      return;
    }
    const active = (content.getRootNode() as Document | ShadowRoot)
      .activeElement;
    if (
      !active ||
      active === content.ownerDocument.body ||
      content.contains(active)
    ) {
      launcherRef.current?.focus({ preventScroll: true });
    }
  }, [drawerOpen]);

  useEffect(() => {
    try {
      localStorage.setItem("mypack-theme-mode", themeMode);
    } catch {
      /* ignore */
    }

    document.documentElement.setAttribute("data-mpp-theme", themeMode);

    const overlayRoot = document.getElementById("extension-overlay-root");
    if (!overlayRoot) {
      return;
    }

    const isDark = themeMode === "dark";
    // Set the attribute so CSS-var blocks (:host([data-mpp-theme="dark"])) apply.
    overlayRoot.setAttribute("data-mpp-theme", themeMode);

    const shadow = overlayRoot.shadowRoot;
    if (shadow) {
      // Tailwind's `.dark *` selector cannot pierce the shadow boundary — the
      // host's class is invisible to shadow-root stylesheets.  Toggle `dark`
      // directly on the .mypack-shell containers inside the shadow root so
      // every portaled descendant is covered.
      shadow.querySelectorAll<HTMLElement>(".mypack-shell").forEach((el) => {
        el.classList.toggle("dark", isDark);
      });
    } else {
      // Staging (no shadow root): toggle on the host element itself.
      overlayRoot.classList.toggle("dark", isDark);
    }
  }, [themeMode]);

  useEffect(() => {
    schedulePlannerSessionPersist({
      version: 1,
      selectedTab,
      courseSearchData,
      majorPlanSearchData,
      GepSearchData,
    });
  }, [courseSearchData, GepSearchData, majorPlanSearchData, selectedTab]);

  useEffect(() => flushPlannerSessionPersist, []);

  const selectedPreviewId = selectedPreview?.id ?? null;
  const previewRail = useMemo(
    () => (
      <MemoizedPlannerPreviewRail
        selectedPreview={selectedPreview}
        isOpen={drawerOpen}
      />
    ),
    [drawerOpen, selectedPreview],
  );
  const inactivePreviewRail = useMemo(
    () => (
      <MemoizedPlannerPreviewRail selectedPreview={null} isOpen={drawerOpen} />
    ),
    [drawerOpen],
  );

  return (
    <div className="mypack-shell flex flex-col items-end gap-2">
      <PlannerLauncherHint enabled={showLauncherHint && !drawerOpen}>
        <Button
          ref={launcherRef}
          type="button"
          onClick={handleDrawerOpen}
          onPointerEnter={warmUp}
          onFocus={warmUp}
          size="sm"
          aria-label="Open Pack Planner"
          data-hidden={drawerOpen || undefined}
          inert={drawerOpen}
          className={cn(
            plannerFloatingButtonClassName,
            plannerLauncherClassName,
          )}
        >
          <GraduationCapIcon className="size-4" strokeWidth={2.25} />
          Pack Planner
        </Button>
      </PlannerLauncherHint>

      <Dialog
        open={drawerOpen}
        modal={false}
        onOpenChange={(open) => {
          if (!open && drawerOpen) {
            handleDrawerClose();
          }
        }}
      >
        <DialogContent
          ref={contentRef}
          container={portalContainer}
          forceMount={panelMounted || undefined}
          inert={!drawerOpen}
          showCloseButton={false}
          overlayClassName={cn(
            plannerOverlayClassName,
            parked && "planner-parked",
          )}
          onOverlayPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              handleDrawerClose();
            }
          }}
          // Mounted closed on warm-up: keep focus out of the hidden panel.
          onOpenAutoFocus={(e) => {
            if (!drawerOpen) e.preventDefault();
          }}
          // It never unmounts on close; the focus effect above handles this.
          onCloseAutoFocus={(e) => e.preventDefault()}
          onAnimationStart={handlePanelAnimationStart}
          onAnimationEnd={handlePanelAnimationEnd}
          onWheelCapture={(e) => e.stopPropagation()}
          onTouchMoveCapture={(e) => e.stopPropagation()}
          className={cn(
            plannerDrawerContentClassName,
            parked && "planner-parked",
          )}
        >
          <TooltipProvider delayDuration={150}>
            <DialogTitle className="sr-only">Pack Planner</DialogTitle>
            <DialogDescription className="sr-only">
              Use Search to filter sections, pick a row to pin the preview, and
              compare options with schedule context.
            </DialogDescription>

            <Tabs
              value={selectedTab}
              activationMode="manual"
              onValueChange={(value) => {
                const next = value as PlannerWorkbenchTab;
                setSelectedTab(next);
                setMountedTabs((tabs) =>
                  tabs.has(next) ? tabs : new Set([...tabs, next]),
                );
                persistPlannerSelectedTab(next);
                setSelectedPreview(null);
              }}
              className="flex min-h-0 max-h-full flex-1 flex-col gap-0 overflow-hidden"
            >
              <div className="shrink-0 border-b border-border/60 bg-muted/25 px-3 py-3 sm:px-6 sm:py-5 dark:bg-background/40">
                <div className="mb-3 flex min-h-7 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                      Pack Planner
                    </div>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                      Use Search to filter, then pick a row to pin the preview
                      and compare sections side by side.
                    </p>
                  </div>

                  <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                    <UpdateReadyPill className="shrink-0" />
                    <StatusBanner className="shrink-0" />
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className={plannerActionButtonClassName}
                    >
                      <a href="mailto:nicktornberg12@gmail.com?subject=Pack%20Planner%20Feedback">
                        Report bug / Feedback
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className={plannerActionButtonClassName}
                      onClick={() =>
                        setThemeMode((current) =>
                          current === "dark" ? "light" : "dark",
                        )
                      }
                      aria-label={`Switch to ${
                        themeMode === "dark" ? "light" : "dark"
                      } mode`}
                    >
                      {themeMode === "dark" ? (
                        <SunMediumIcon />
                      ) : (
                        <MoonStarIcon />
                      )}
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DialogClose asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className={plannerActionButtonClassName}
                            aria-label="Close planner"
                          >
                            <XIcon strokeWidth={2.25} />
                          </Button>
                        </DialogClose>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={6}>
                        Close planner
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                <TabsList
                  variant="segmented"
                  className="w-full min-w-0 max-sm:min-h-10 sm:min-h-12 sm:max-w-2xl"
                  aria-label="Planner search tabs"
                >
                  <TabsTrigger
                    value="course_search"
                    className="min-w-0 truncate"
                  >
                    Course Search
                  </TabsTrigger>
                  <TabsTrigger value="gep_search" className="min-w-0 truncate">
                    GEP Search
                  </TabsTrigger>
                  <TabsTrigger
                    value="major_plan_search"
                    className="min-w-0 truncate"
                  >
                    Major Plan Search
                  </TabsTrigger>
                  <TabsTrigger
                    value="instructor_search"
                    className="min-w-0 truncate"
                  >
                    Instructors
                  </TabsTrigger>
                </TabsList>
              </div>

              <div
                id="dialog-scroll-container"
                className="min-h-0 max-h-full flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain [scrollbar-gutter:stable] bg-muted/15 touch-pan-y dark:bg-background/30"
                onWheelCapture={(e) => e.stopPropagation()}
                onTouchMoveCapture={(e) => e.stopPropagation()}
              >
                <TabsContent
                  value="course_search"
                  forceMount
                  className={
                    selectedTab === "course_search"
                      ? "planner-tab-panel block min-h-0"
                      : "hidden min-h-0"
                  }
                >
                  {mountedTabs.has("course_search") ? (
                    <MemoizedCourseSearchTab
                      setCourseSearchTabData={setCourseSearchTabData}
                      courseSearchData={courseSearchData}
                      onPreviewSectionChange={setSelectedPreview}
                      previewContent={
                        selectedTab === "course_search"
                          ? previewRail
                          : inactivePreviewRail
                      }
                      selectedPreviewId={
                        selectedTab === "course_search"
                          ? selectedPreviewId
                          : null
                      }
                    />
                  ) : null}
                </TabsContent>
                <TabsContent
                  value="gep_search"
                  forceMount
                  className={
                    selectedTab === "gep_search"
                      ? "planner-tab-panel block min-h-0"
                      : "hidden min-h-0"
                  }
                >
                  {mountedTabs.has("gep_search") ? (
                    <MemoizedGepSearchTab
                      setGepSearchTabData={setGepSearchTabData}
                      GepSearchData={GepSearchData}
                      onPreviewSectionChange={setSelectedPreview}
                      previewContent={
                        selectedTab === "gep_search"
                          ? previewRail
                          : inactivePreviewRail
                      }
                      selectedPreviewId={
                        selectedTab === "gep_search" ? selectedPreviewId : null
                      }
                      isActive={selectedTab === "gep_search"}
                    />
                  ) : null}
                </TabsContent>
                <TabsContent
                  value="major_plan_search"
                  forceMount
                  className={
                    selectedTab === "major_plan_search"
                      ? "planner-tab-panel block min-h-0"
                      : "hidden min-h-0"
                  }
                >
                  {mountedTabs.has("major_plan_search") ? (
                    <MemoizedMajorPlanSearchTab
                      setMajorPlanSearchTabData={setMajorPlanSearchTabData}
                      majorPlanSearchData={majorPlanSearchData}
                      onPreviewSectionChange={setSelectedPreview}
                      previewContent={
                        selectedTab === "major_plan_search"
                          ? previewRail
                          : inactivePreviewRail
                      }
                      selectedPreviewId={
                        selectedTab === "major_plan_search"
                          ? selectedPreviewId
                          : null
                      }
                    />
                  ) : null}
                </TabsContent>
                <TabsContent
                  value="instructor_search"
                  forceMount
                  className={
                    selectedTab === "instructor_search"
                      ? "planner-tab-panel block min-h-0"
                      : "hidden min-h-0"
                  }
                >
                  {mountedTabs.has("instructor_search") ? (
                    <InstructorSearch />
                  ) : null}
                </TabsContent>
              </div>
            </Tabs>
          </TooltipProvider>
        </DialogContent>
      </Dialog>
    </div>
  );
}
