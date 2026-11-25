-- install.sh writes this code under lines that set REXYSTELE_BIN, STELE_BIN and GIT_BIN,
-- the paths of the viewer, Stele and git.

local PLACEMENTS = { split = true, zoomed = true, tab = true, overlay = true }
local SPLIT_DIRECTIONS = { right = "horizontal", down = "vertical" }
local TERMINAL = "com.superlogical.terminal"
local PANE_LABEL = "rexystele"
local DEFAULT_KEY = "shift+cmd+e"

local function must(result, call_error)
  if call_error ~= nil then error(call_error, 0) end
  return result
end

local function window_of(blocks, block_id)
  for _, block in ipairs(blocks) do
    if block.block_id == block_id then return block.window_id end
  end
  return nil
end

local function open_viewer_panes(blocks, window_id)
  local pane_ids = {}
  for _, block in ipairs(blocks) do
    local in_window = window_id == nil or block.window_id == window_id
    if block.creator_name == TERMINAL and in_window and block.label == PANE_LABEL then
      table.insert(pane_ids, block.block_id)
    end
  end
  return pane_ids
end

-- Without this check a missing viewer closes the new pane before its error shows.
local function check_viewer_runs()
  local result, exec_error = rex.exec({ REXYSTELE_BIN, "--version" }, { timeout = 5 })
  if result == nil then error("cannot run " .. REXYSTELE_BIN .. ": " .. tostring(exec_error), 0) end
  if not result.ok then error((result.stderr:gsub("%s+$", "")), 0) end
end

-- The directory of the program in the focused pane, so the viewer follows the worktree
-- that pane works in.
local function working_directory(block_id)
  if not block_id then return nil end
  local found, process = pcall(function()
    return must(rex.block.call(TERMINAL, "process", { block_id = block_id }))
  end)
  if not found or type(process) ~= "table" then return nil end
  local directory = (process.foreground or {}).cwd
  if directory then return directory end
  for _, ancestor in ipairs(process.ancestors or {}) do
    if ancestor.cwd then return ancestor.cwd end
  end
  return (process.child or {}).cwd
end

local function viewer_command(focused_block_id, base_branch, editor)
  local command = { REXYSTELE_BIN, "--stele", STELE_BIN, "--git", GIT_BIN }
  local directory = working_directory(focused_block_id)
  if directory then
    table.insert(command, "--cwd")
    table.insert(command, directory)
  end
  if base_branch then
    table.insert(command, "--base-branch")
    table.insert(command, base_branch)
  end
  if editor then
    table.insert(command, "--editor")
    table.insert(command, editor)
  end
  return command
end

local function open_viewer(ctx, window_id, placement, direction, ratio, base_branch, editor)
  local focused_block_id = ctx.block_id
  local pane = rex.layout.block{
    flavor = TERMINAL .. ".shell",
    label = PANE_LABEL,
    options = { command = viewer_command(focused_block_id, base_branch, editor) },
  }
  if placement == "tab" then
    return must(rex.session.new_window{ window_label = PANE_LABEL, layout = pane })
  elseif placement == "overlay" then
    return must(rex.session.new_layer{
      window_id = window_id,
      bounds = { 0.04, 0.04, 0.92, 0.92 },
      layout = pane,
      focus = true,
    })
  end
  local split = must(rex.session.new_split{
    anchor_id = focused_block_id,
    direction = SPLIT_DIRECTIONS[direction],
    side = "after",
    ratio = 1 - ratio,
    focus = true,
    layout = pane,
  })
  if placement == "zoomed" then
    must(rex.session.zoom_block{ block_id = split.block_ids[1], zoom = true })
  end
  return split
end

return function(settings)
  if type(settings) ~= "table" then
    error("config: settings must be a table, as in: local settings = { }", 0)
  end
  local key = settings.key
  if key == nil then key = DEFAULT_KEY end
  local default_placement = settings.placement or "overlay"
  local direction = settings.direction or "right"
  local ratio = settings.ratio or 0.5
  local base_branch = settings.base_branch
  local editor = settings.editor
  if not PLACEMENTS[default_placement] then
    error("config: unknown placement " .. tostring(default_placement)
      .. "; use split, zoomed, tab, or overlay", 0)
  end
  if not SPLIT_DIRECTIONS[direction] then
    error("config: unknown direction " .. tostring(direction) .. "; use right or down", 0)
  end
  if type(ratio) ~= "number" or ratio <= 0 or ratio >= 1 then
    error("config: ratio must be a number between 0 and 1", 0)
  end
  if base_branch ~= nil and type(base_branch) ~= "string" then
    error("config: base_branch must be a branch name, as in \"main\"", 0)
  end
  if editor ~= nil and type(editor) ~= "string" then
    error("config: editor must be an editor's name, as in \"rubymine\", or a command with {file} in it", 0)
  end

  rex.action{
    name = "rexystele_toggle",
    title = "Toggle Stele intent impact",
    description = "Show which statements of the Stele catalog the focused pane's change touches, or close the view",
    category = "RexyStele",
    keywords = "stele intent impact catalog statements definitions change diff review",
    args = { placement = "string?" },
    run = function(ctx, args)
      local placement = args.placement or default_placement
      if not PLACEMENTS[placement] then
        error("unknown placement " .. tostring(placement)
          .. "; use split, zoomed, tab, or overlay", 0)
      end
      local blocks = must(rex.session.list_blocks{}).blocks or {}
      local window_id = window_of(blocks, ctx.block_id)
      local open_pane_ids = open_viewer_panes(blocks, window_id)
      if #open_pane_ids == 0 then
        check_viewer_runs()
        return open_viewer(ctx, window_id, placement, direction, ratio, base_branch, editor)
      end
      for _, pane_id in ipairs(open_pane_ids) do
        must(rex.call("block.close", { session_id = ctx.session_id, block_id = pane_id }))
      end
      return { closed = open_pane_ids }
    end,
  }
  if key then rex.bind(key, "rexystele_toggle") end
end
