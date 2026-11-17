# Gigga-Goat UI sprites (pre-sliced, ready to use)

Every UI element from the GPT-image sheets in `../sheets/` is saved here as its own transparent PNG, so no slicing is needed.
`sprites.json` maps each name to its file (`assets/ui/sprites/<group>/<name>.png`, relative to the site root) and its pixel size.

Load the files through a root-safe public-asset URL so they work on GitHub Pages. Use 9-slice `border-image` (or nine-patch canvas drawing) for the stretchable frames, pills, banners and buttons, and keep text and numbers as live HTML or canvas on top.

## HUD frames and panels (from 01_panels)

`size_meter_frame` (542x272), `score_starburst` (563x263), `minimap_ring` (311x337), `gig_card` (457x228), `stamina_ring` (243x252), `hotbar_tray` (738x233), `hotbar_slot_selected` (197x194), `hotbar_slot` (176x176), `key_badge` (103x105), `prompt_pill` (282x105), `banner_purple` (533x115), `banner_brown` (467x103), `banner_gold` (356x95), `tab_pill_blue` (161x76), `tab_pill_purple` (153x73), `tab_pill_brown` (146x72), `tab_pill_gold` (144x72), `wheat_divider` (288x78), `hammer_badge` (111x97), `arrow_left` (80x77), `arrow_right` (81x77), `spark_rays` (100x63)

## Icons (from 02_icons)

`goat_kid` (164x174), `goat_billy` (205x213), `goat_big` (247x240), `goat_gigga` (350x283), `stamina_hooves` (218x205), `hay_floor` (276x246), `fence_wall` (264x223), `hay_ramp` (273x231), `launch_pad` (246x224), `supplies_crate` (248x238), `gig_clipboard` (222x248), `cud_coin` (236x242), `combo_star` (308x253), `compass_n` (218x220), `map_pin` (192x241), `marker_barn` (247x203), `marker_house_blue` (230x210), `marker_house_pink` (224x210), `marker_tree_round` (229x231), `marker_tree_pine` (192x239), `marker_tree_apple` (229x231)

## Menu pieces (from 03_menus)

`button_yellow_normal` (326x136), `button_yellow_hover` (326x144), `button_yellow_pressed` (321x144), `button_purple_normal` (323x126), `button_purple_hover` (317x128), `button_purple_pressed` (319x126), `panel_tall` (540x796), `stat_card` (431x191), `toggle_off` (235x124), `toggle_on` (240x124), `slider` (903x99), `checkbox_empty` (122x124), `checkbox_checked` (122x123), `button_close` (150x151), `button_back` (152x153), `tab_brown` (447x165), `tab_gold_active` (447x174), `tab_purple` (458x165)

License: original art made for Gigga-Goat (CC0).
