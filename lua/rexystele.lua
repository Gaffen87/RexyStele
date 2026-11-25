-- Settings of RexyStele. install.sh wrote this file and never overwrites it.
-- To change a setting, edit it, then run "rex config reload".
local settings = {
  -- key = "shift+cmd+e", -- the key of the toggle, or false for none
  -- placement = "overlay", -- overlay, split, zoomed, or tab
  -- direction = "right", -- of split and zoomed: right or down
  -- ratio = 0.5, -- the share of the split that RexyStele gets
  -- base_branch = "main", -- the branch a change is compared with, when the guess is wrong
  -- editor = "rubymine", -- opens files: rubymine, idea, webstorm, vscode, cursor, zed, sublime,
  --                      -- or a command such as "nvim +{line} {file}"; the default app when unset
}

local loaded, load_error = pcall(function() require("rexystele_toggle")(settings) end)
if not loaded then
  rex.action{ name = "rexystele_toggle", title = "Toggle Stele intent impact",
    run = function() error("RexyStele: " .. tostring(load_error), 0) end }
  local key = type(settings) == "table" and settings.key
  if key == nil then key = "shift+cmd+e" end
  if key then rex.bind(key, "rexystele_toggle") end
end
