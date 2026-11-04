-- Expand first so existing media records can be mapped without deletion.
ALTER TABLE `Banner` MODIFY `position` ENUM('SIDE_LEFT','MAIN_TOP','MAIN_BOTTOM','SIDE_RIGHT_TOP','SIDE_RIGHT_MIDDLE','SIDE_RIGHT_BOTTOM','MAIN_HERO','BOTTOM_LEFT','BOTTOM_RIGHT') NOT NULL;
UPDATE `Banner` SET `position` = 'MAIN_HERO' WHERE `position` = 'MAIN_TOP';
UPDATE `Banner` SET `position` = 'BOTTOM_LEFT', `group` = 'SIDE' WHERE `position` = 'MAIN_BOTTOM';
-- Preserve every former lower slide, keeping only the first active in its new static slot.
UPDATE `Banner` AS b JOIN `Banner` AS earlier
ON earlier.position = b.position AND earlier.isActive = true
AND (earlier.sortOrder < b.sortOrder OR (earlier.sortOrder = b.sortOrder AND earlier.id < b.id))
SET b.isActive = false WHERE b.position = 'BOTTOM_LEFT' AND b.isActive = true;
ALTER TABLE `Banner` MODIFY `position` ENUM('SIDE_LEFT','MAIN_HERO','BOTTOM_LEFT','BOTTOM_RIGHT','SIDE_RIGHT_TOP','SIDE_RIGHT_MIDDLE','SIDE_RIGHT_BOTTOM') NOT NULL;
