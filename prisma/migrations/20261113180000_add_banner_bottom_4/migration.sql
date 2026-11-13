-- AlterTable: thêm vị trí banner thứ 4 ở hàng dưới trang chủ (chỉ thêm giá trị enum, không đụng dữ liệu cũ)
ALTER TABLE `Banner` MODIFY `position` ENUM('SIDE_LEFT','MAIN_HERO','BOTTOM_LEFT','BOTTOM_RIGHT','SIDE_RIGHT_TOP','SIDE_RIGHT_MIDDLE','SIDE_RIGHT_BOTTOM','BOTTOM_4') NOT NULL;
