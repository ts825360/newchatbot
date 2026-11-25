import { strToU8, zipSync } from "fflate";

export const fixtureNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function syntheticWord(body: string, prefix = "") {
  return zipSync({
    "word/document.xml": strToU8(`<?xml version="1.0"?>${prefix}<w:document xmlns:w="${fixtureNamespace}"><w:body>${body}</w:body></w:document>`),
    "word/_rels/document.xml.rels": strToU8("https://example.invalid/not-to-be-opened"),
  });
}

export const syntheticResume = '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>가상 이력서</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>모의 경력</w:t><w:tab/><w:t>운영팀</w:t></w:r></w:p>'
  + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>경력</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>&lt;img src=x&gt;</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
