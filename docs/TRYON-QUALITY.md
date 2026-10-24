# Nâng chất lượng Thay trang phục — 22/10/2026

Phần mềm đã bổ sung cách giữ tỷ lệ ảnh, mở rộng vùng thay theo trang phục mới và kiểm tra kết quả trước khi chọn. Có thêm thử nghiệm huấn luyện CatVTON từ ảnh thật Couple Tee, lưu riêng với model đang dùng. Những thay đổi này chưa phải chứng nhận ảnh giống đúng sản phẩm.

## Các thay đổi

- CatVTON và IDM-VTON nhận khung 3:4. Ảnh người, vùng thay và DensePose dùng cùng hệ tọa độ; ảnh được thêm lề thay vì kéo giãn. Kết quả trả về kích thước ảnh gốc.
- Ghép mềm chỉ diễn ra bên trong vùng thay. Vùng ngoài và vùng bảo vệ được phục hồi từ ảnh gốc, kể cả sau bước sửa biên.
- Tay áo, chiều dài và dáng do người dùng chọn tạo một vùng dự kiến theo tư thế. Vùng thay là hợp của trang phục cũ và vùng dự kiến, để có thể thay đồ rộng hơn hoặc xử lý đồ cũ ngoài trang phục mới. Thiếu điểm tư thế sẽ có cảnh báo.
- Bản đồ trang phục dự kiến và vùng có thể lộ cơ thể được lưu để kiểm tra. Đây là gợi ý hình học; chưa có mô hình phân vùng cơ thể học riêng. Cổ áo và số lớp được lưu để đối chiếu, chưa có bộ kiểm định tự động đáng tin cậy cho hai thuộc tính này.
- Ảnh có người mặc mẫu được tách trang phục trước bước tách nền. Có thể chỉ định loại ảnh để tránh nhận diện nhầm. Chuẩn hóa ảnh mẫu không tự cắt gấu hoặc cổ tay áo chỉ để giảm điểm nhiễm nền.
- Bộ chấm điểm phiên bản 2 kiểm tra thêm màu/chất liệu, bất thường hình ảnh và độ dịch chuyển các khớp nhìn thấy. Không nhận diện được tư thế sẽ được báo chưa đủ dữ liệu.
- Phương án vượt mọi ngưỡng được ưu tiên trước điểm xếp hạng. Chế độ hai giai đoạn dựng lại tối đa hai phương án ở độ phân giải cuối. Kết quả hàng loạt lấy đúng seed mà lượt chạy đã chọn.
- Sửa biên được chấp nhận khi cải thiện biên và không làm xuất hiện lỗi kiểm định mới; có giới hạn suy giảm độ giống mẫu, màu/chất liệu, điểm bảo toàn và hình học. Sửa tay thử nghiệm cũng phải vượt kiểm tra lại.
- Tạo hoặc đổi ảnh đưa kết quả về chờ duyệt. Danh sách lỗi có thêm chiều dài gấu, lớp áo và trang phục cũ còn sót.
- Thay bằng mô tả dùng thông số riêng của model. FLUX dùng guidance 30 theo cấu hình hiện tại và không gửi negative prompt; SDXL dùng thông số của SDXL. Người dùng có thể chỉnh số bước, mức thay đổi và độ phân giải.
- Hiệu chỉnh ngưỡng chỉ áp dụng khi có ít nhất 10 ảnh được chấp nhận với bộ chấm điểm phiên bản 2. Con số này là điều kiện tối thiểu vận hành, chưa phải bảo đảm đủ dữ liệu thống kê. So sánh hồi quy từ chối trộn phiên bản chấm điểm hoặc loại trang phục.

## Cách dùng

1. Chọn ảnh người và loại trang phục. Với ảnh mẫu, chọn ảnh sản phẩm hoặc ảnh có người mặc nếu tự nhận diện không đúng.
2. Mở “Phạm vi thay và chi tiết cần đối chiếu”, chọn các thuộc tính nhìn rõ trên mẫu, rồi tạo lại vùng tự động. Kiểm tra vùng tô và vùng bảo vệ trước khi chạy.
3. Sau khi tạo, đối chiếu cổ, tay áo, gấu, số lớp, màu, họa tiết, tay/chân và quần áo cũ. “Đạt kiểm tra tự động” vẫn cần bước này.
4. Với mô tả, chọn model rồi kiểm tra “Thông số tạo trang phục”. Việc bám đúng từng chi tiết mô tả vẫn cần duyệt trực quan.

## Phạm vi kiểm chứng

Bộ kiểm tra phần mềm có kết quả tại `workspace/diagnostics/tryon-quality-20261022/python-tests.json` và `javascript-tests.json`. Kiểm tra đóng gói tại `package-test.log`. Dịch vụ đang chạy có thể đối chiếu mã nguồn qua trường `revision` của `/health`.

Các ảnh GPU dùng cùng ba ca áo, váy và quần có sẵn, cùng seed, 30 bước, hai phương án và kích thước tối đa 1024. Ảnh nguồn là ảnh minh họa có sẵn, không phải bộ ảnh chụp ghép thật để đo độ chính xác sản phẩm. Thử nghiệm hai giai đoạn mới dựng hai ảnh cuối, nên tốn thời gian hơn bản cũ dựng một ảnh.

- `before-catvton`: phiên bản cũ.
- `after-catvton-native`: CatVTON với khung 3:4 và bộ chấm điểm mới.
- `after-idm-vton-native`: IDM-VTON với xử lý ảnh mới; không có baseline IDM cùng ca, nên không kết luận mức cải thiện IDM.
- `after-catvton`: lần thử trung gian trước khi cố định khung CatVTON 3:4, giữ lại để truy vết.

Mỗi thư mục có ảnh, `report.json` và `comparison.jpg`. Báo cáo ghi phiên bản mã nguồn thực tế đã chạy. Không so trực tiếp điểm tổng cũ và mới vì công thức khác nhau. Màu/chất liệu và hình học là phép đo gần đúng; chưa kiểm định được chính xác cổ áo, chiều dài, logo hoặc cấu trúc nhiều lớp. Vùng lộ da và nền nằm trong mask có thể ảnh hưởng điểm màu. Kiểm tra khớp không đánh giá ngón tay hay hình dạng cơ thể bị che.

## Huấn luyện thử với dữ liệu thật

Người dùng đã cung cấp `samples/couple_tee`: 45 ảnh, 15 sản phẩm, 30 cặp sản phẩm–người mặc. Giữ 24 cặp của 12 sản phẩm để học, 6 cặp của 3 sản phẩm để kiểm định. Việc ghép cặp dựa trên tên tệp và đối chiếu trực quan. Không dùng các hậu tố tên tệp làm danh tính người mẫu; tính độc lập về người mẫu chưa được xác minh. Thông tin quyền sử dụng chưa có được ghi là chưa biết.

`scripts/prepare-couple-tee.py` tạo ảnh mặt trước, vùng chọn áo và bản kiểm tra. Các chỉnh sửa vùng chọn được lưu trong `workspace/training/couple-tee-intake/annotations.json`. Ảnh gốc không đổi. `scripts/train-vton-pilot.py` huấn luyện self-attention, giữ các phần còn lại cố định, kiểm tra dữ liệu đã duyệt và chặn rò rỉ sản phẩm/ảnh giữa các nhóm. `scripts/report-vton-pilot.py` tạo đối chiếu trước/sau, gồm cả tái tạo đúng áo và thay sang áo khác. `scripts/verify-vton-pilot-checkpoint.py` kiểm tra nạp trọng số bằng bộ nạp thật.

Hai cấu hình thử nghiệm được lưu riêng tại `workspace/training/couple-tee-run-20261022` và `workspace/training/couple-tee-run-20261022-extended`. Mỗi lượt có nhật ký, trạng thái bộ tối ưu, trọng số, chỉ số và ảnh. Kết luận cuối cùng nằm trong `visual-review.json` và `review.html` của mỗi lượt. Không tự bật checkpoint thử nghiệm trong ứng dụng.

Kết quả trên sáu ảnh tái tạo ở 384 × 512:

| Phiên bản | Sai số màu MAE vùng thay, thấp hơn tốt hơn |
| --- | ---: |
| Model gốc | 59,371 |
| 48 bước cập nhật | 57,108 |
| 192 bước cập nhật | 44,361 |

Lượt dài giảm MAE 25,3%. Đối chiếu trực quan cho thấy màu nền và dáng áo tốt hơn, nhưng sọc, logo và độ dài tay vẫn sai; một số ảnh thay áo ngắn còn giữ tay áo dài cũ. Vì vậy chưa thay model đang dùng. Cả hai checkpoint đã được nạp lại bằng bộ nạp CatVTON, kiểm tra đủ 80 tensor và 112 tham chiếu dùng chung. Các ảnh baseline của hai lượt trùng nội dung; ảnh nguồn và trọng số đang cài không đổi. Bốn bộ kiểm tra liên quan đều đạt, kết quả tổng hợp tại `workspace/training/couple-tee-intake/completion-summary.json`.

Bộ này chỉ có áo và còn một số phụ kiện, lỗi biên tách nền. Các ngưỡng dữ liệu đầy đủ tại `scripts/validate-vton-paired-dataset.py` và `workspace/training/vton-paired/` được giữ nguyên. Kết quả kiểm định trên ba sản phẩm không thay thế đánh giá lớn hơn với người mẫu độc lập, nhiều tư thế, quần/váy và các thuộc tính còn thiếu.

## Đối chứng ảnh thật và sửa vùng áo

Lượt tiếp theo dùng ảnh người gốc, khung mô hình 768 × 1024, cùng 12 ca (6 tái tạo, 6 đổi áo), seed và 30 bước cho CatVTON gốc, CatVTON tinh chỉnh và IDM-VTON. `scripts/benchmark-real-vton.py` cố định đầu vào bằng mã băm, có thể tiếp tục lượt dở và lưu ảnh đầu vào mô hình, ảnh thô, ảnh phục hồi tỷ lệ và ảnh sau ghép. Bộ mã nguồn dùng trong phép so sánh được lưu riêng vì dự án đồng thời có cập nhật mở rộng ảnh. Phiên bản vùng chọn và phiên bản sinh ảnh đều được ghi nhận; không trộn kết quả khi cấu hình thay đổi.

Đã sửa IDM-VTON để mã hóa tư thế bằng generator của từng ảnh, thay cho lấy mẫu ngẫu nhiên toàn cục. Bước này hỗ trợ danh sách generator khi xử lý nhiều ảnh. Mã suy luận IDM được đưa vào dấu phiên bản dịch vụ khi có cài đặt. Lượt IDM dở trước sửa lỗi được lưu trong `aborted/idm-unseeded-pose`, loại khỏi phép so sánh; lượt chạy lại ghi riêng mã băm pipeline đã sửa.

Chuỗi giải phóng bộ nhớ IDM cũng được bổ sung cạnh quay lại của vòng lặp: chuyển UNet ở bước trước về CPU trước khi mạng mã hóa áo chạy tiếp. Chuỗi cũ chỉ xử lý chiều từ mạng mã hóa áo sang UNet, nên có lúc cả hai cùng nằm trên GPU. Bản sửa giữ chuỗi giải phóng các bộ mã hóa khác, không đổi trọng số hoặc số bước; có kiểm tra thứ tự gọi và tránh đăng ký hook trùng. Thử nghiệm dở do áp lực bộ nhớ được lưu riêng trong `aborted/idm-memory-pressure`.

Hai lỗi vùng áo được sửa trong `automatic_garment_mask`: giới hạn ngang hông cắt mất gấu áo; và gộp quá rộng một đề xuất SAM có cả quần. Vùng tìm áo nay dựa trên vai, hông và tư thế tay, giữ khoảng cho gấu dưới hông. Điểm chọn nằm trong thân áo; đầu gối là điểm loại trừ. Các đề xuất khác chỉ bổ sung quanh mép vùng áo đã chọn. Vùng bảo vệ vẫn bị loại ra sau bước mở rộng.

Kiểm tra 30 ảnh gốc: độ bao phủ trung bình so với vùng SAM đã duyệt tăng từ 78,77% lên 99,94%; số điểm ảnh áo đối chứng bị bỏ sót giảm từ 984.184 xuống 2.339. Không có vùng bảo vệ nào bị chọn vào. Đây là phép đo độ bao phủ, không phải độ chính xác phân vùng hoặc chất lượng ảnh sinh. Vùng tóc, da, phụ kiện và quần sát gấu vẫn cần kiểm tra. Ảnh đối chiếu và ghi chú tại `workspace/diagnostics/upper-mask-regression-20261022/review.html`.

Các phép đối chứng đầu ra gồm vùng tự động cũ, vùng đã duyệt và vùng tự động mới. Báo cáo nằm tại `workspace/diagnostics/real-vton-20261022/` và `workspace/diagnostics/real-vton-fixed-v3-20261022/`; `visual-review.json` ghi kết luận khi đã duyệt. MAE tái tạo không kiểm định logo, chữ, sọc, chiều dài tay hoặc sự tự nhiên của cơ thể. Vùng áo cũ bị loại khỏi mask cũng có thể làm MAE tái tạo thấp giả tạo vì được chép nguyên từ ảnh nguồn.

Phép thử chẩn đoán dùng vùng chọn cố định, ảnh sản phẩm đã chuẩn bị, không cắt khung người, không tạo lại cơ thể, sửa biên hay thử lại. Cách này tách ảnh hưởng của vùng chọn, mô hình và ghép ảnh; không đại diện cho mọi cấu hình sửa hậu kỳ của ứng dụng. Vùng cổ cao vẫn được ghi đúng trong danh mục ảnh, nhưng truyền là chưa biết cho enum hiện tại của ứng dụng; không gán nhầm thành cổ tròn.

Kết quả sáu ca tái tạo ở 768 × 1024: MAE của CatVTON gốc là 40,024, bản tinh chỉnh là 39,331 và IDM-VTON là 45,916. Mức giảm của bản tinh chỉnh chỉ còn khoảng 1,73% ở cấu hình này; không dùng lại con số 25,3% của thử nghiệm 384 × 512. IDM-VTON giữ sọc rõ hơn ở một số ảnh, dù MAE cao hơn, nhưng vẫn sai chữ/logo và có ca chưa tạo đúng chiều dài tay. Không mô hình thử nghiệm nào được chọn thay mô hình đang cài.

Các lỗi còn lại được lưu trong nhận xét từng ảnh: gấu có mảng vuông bám theo vùng chọn, sọc áo cũ bị giữ gần bàn tay, cổ/tay áo cũ còn sót khi đổi sang áo ngắn, và phần cẳng tay có hoa văn giống vải. Vùng bảo vệ tự động cũng phải được duyệt; giữ nguyên điểm ảnh trong vùng đó không chứng minh vùng bảo vệ được phân đúng. Trang tổng hợp có ví dụ cải thiện và ca chưa đạt tại `workspace/diagnostics/real-vton-20261022/index.html`.

## Tiếp nhận bộ bổ sung

`workspace/training/vton-expansion-20261022/` chứa danh mục 30 cặp cũ và kế hoạch thu thập ban đầu 120 cặp mới: 80 học, 20 chọn cấu hình, 20 kiểm tra cuối. Đây là mốc lập kế hoạch, không phải bảo đảm thống kê. Bộ `samples/couple_tee_2` có 32 cặp thuộc 18 sản phẩm, trong đó 8 cặp/4 sản phẩm trùng hoàn toàn bộ cũ. Đã tiếp nhận 24 cặp mới của 14 sản phẩm. Người dùng xác nhận chưa có bảng mã người mẫu; chưa có bộ kiểm tra độc lập về người mẫu.

Chuẩn bị dữ liệu hỗ trợ sản phẩm chỉ có một ảnh người mặc, chỉnh vùng chọn theo ảnh và các khung 384 × 512, 576 × 768, 768 × 1024. Bộ mới dùng tiền tố mã riêng vì tên “dễ mặc” xuất hiện ở hai thư mục nhưng là hai sản phẩm khác nhau. Đã loại phần tay ma-nơ-canh ở sáu ảnh mẫu và khôi phục vùng vải cổ tròn bị SAM loại nhầm theo dây chuyền ở hai ảnh. Các đa giác chỉnh sửa được lưu trong `workspace/training/couple-tee-2-intake/annotations.json`; không sửa ảnh nguồn.

`scripts/prepare-vton-combined.py` ghép bộ cũ và mới, giữ nguyên nhóm sản phẩm cũ, kiểm tra mã băm và nội dung điểm ảnh nguồn, dựng lại ảnh người từ ảnh gốc và mask gốc khi cần nâng khung. Không phóng ảnh người 384 × 512 để thay cho ảnh gốc. Bộ kết hợp có 54 cặp, 29 sản phẩm, 42 học/12 kiểm định ở 768 × 1024, đã duyệt chín bảng ảnh. Vùng tóc, phụ kiện, trang phục sơ vin/xắn tay và lỗi biên còn là giới hạn của dữ liệu thử nghiệm.

`scripts/register-vton-expansion.py` ghi nhận 24 cặp mới trong kế hoạch dữ liệu đầy đủ nhưng giữ mã người mẫu, tiêu chí chụp và hồ sơ nguồn chưa xác nhận ở trạng thái chưa biết. Trình kiểm tra phân biệt `receivedRecords` với số bản ghi qua bước kiểm tra mã định danh; không hạ ngưỡng để đổi trạng thái thành sẵn sàng. Còn thiếu 96 cặp so với mục tiêu số lượng ban đầu, và chưa có tập test độc lập.

Trình kiểm tra dữ liệu hỗ trợ `--categories upper_body`, nhóm `test`, ngưỡng kiểm tra cuối và `--seen-manifest`. Mặc định vẫn kiểm tra ba loại trang phục với ngưỡng học/kiểm định cũ. Trình kiểm tra từ chối mã người mẫu chưa biết, nội dung ảnh trùng giữa các nhóm và sản phẩm/người mẫu/ảnh đã dùng xuất hiện trong test mới. Muốn xác nhận độc lập về người mẫu, cần bổ sung mã người mẫu thật cho cả danh mục lịch sử. Không suy ra mã này từ ảnh hoặc tên tệp; không đổi tên sáu ảnh kiểm định đã dùng thành test mới.

## Kết quả huấn luyện bộ kết hợp ở 768 × 1024

Lượt `workspace/training/couple-tee-combined-run-20261022` đã hoàn tất 192 bước cập nhật với 42 cặp học và 12 cặp kiểm định thuộc 6 sản phẩm riêng. Mô hình bắt đầu từ trọng số CatVTON đang cài; chỉ cập nhật self-attention. Mỗi bản tạo 12 ảnh tái tạo và 12 ảnh đổi áo, cùng đầu vào, seed và 30 bước suy luận. Tổng cộng có 48 ảnh đã kiểm tra trực quan. Toàn bộ lượt chạy mất 3.430 giây, bộ nhớ huấn luyện được PyTorch ghi nhận cao nhất 4.154 MiB.

| Nhóm ảnh kiểm định | MAE vùng áo trước | MAE vùng áo sau |
| --- | ---: | ---: |
| Cả hai bộ, 12 ảnh | 35,866 | 46,332 |
| `couple_tee`, 6 ảnh | 47,287 | 46,416 |
| `couple_tee_2`, 6 ảnh | 24,444 | 46,248 |

Sai số chung tăng 29,2%. Nhóm cũ giảm 1,84% nhưng nhóm mới tăng 89,2%. Kiểm tra trực quan phát hiện các suy giảm rõ: áo trắng thành nâu hoặc đỏ, áo đen thành be, xuất hiện mảng nâu ở gấu và chữ/ngôi sao bị biến dạng. Lỗi chiều dài tay và hoa văn áo cũ trên cẳng tay chưa được khắc phục. Vì vậy **loại checkpoint này khỏi triển khai, giữ mô hình đang dùng**. Việc quá trình huấn luyện chạy thành công không đồng nghĩa chất lượng ảnh được cải thiện.

`review.html` có ảnh đầy đủ và nhận xét từng ca. `visual-review.json` ghi quyết định cùng giới hạn của đánh giá. Bộ nạp thật đã xác nhận 80 tensor và 112 tham chiếu dùng chung khớp checkpoint. `scripts/verify-vton-pilot-run.py` kiểm tra lại đủ 192 bước, 48 ảnh đúng kích thước, vùng đổi áo trùng giữa hai bản, tính lại MAE từ điểm ảnh, kiểm tra 204 liên kết báo cáo, mã băm dữ liệu và trọng số. Kết quả tại `artifact-verification.json`; không sửa trọng số đang cài. Kiểm tra lại 95 ảnh gốc cho thấy nội dung không đổi. Hai bộ kiểm tra dữ liệu và kiểm tra đóng gói đều đạt, nhật ký tại `workspace/training/couple-tee-2-intake/`.

Các ảnh thử là đầu ra thô trước bước ghép bảo toàn của ứng dụng. Không so trực tiếp các con số này với phép đối chứng ứng dụng trước đó vì cách chuẩn bị vùng thay và ghép ảnh khác nhau. Lượt này đồng thời đổi lượng dữ liệu và độ phân giải huấn luyện, nên chưa tách được tác động riêng của từng thay đổi. Chưa có mã người mẫu để xác minh độc lập; không dùng kết quả này làm chứng nhận chất lượng tổng quát.

Dịch vụ tại cổng 7861 đã được kiểm tra chỉ đọc và khớp mã runtime hiện tại trong lượt này; kết quả ở `workspace/training/couple-tee-2-intake/runtime-verification.json`. Không thực hiện khởi động lại tiến trình trong lượt tiếp nhận bộ ảnh mới.
