import unittest
from pathlib import Path
from unittest.mock import patch
from lisoft_source import literal, read_dump

class LisoftSourceTests(unittest.TestCase):
    def test_literals(self):
        self.assertEqual(literal(r"'A\'B; C\\D'"), "A'B; C\\D")
        self.assertEqual(literal("'O''Brien'"), "O'Brien")
        self.assertEqual(literal("12.30"), "12.30")
        self.assertIsNone(literal("NULL"))
        with self.assertRaises(ValueError): literal("NOW()")

    def test_filters_tenants_and_credential_tables_without_executing_sql(self):
        sql = "INSERT INTO `user_product` (`user_product_id`,`user_product_company_id`,`user_product_name`) VALUES (1,1,'Name; with comma, and \\'quote'),(2,2,'Other tenant'),(3,30,'Sky');\nINSERT INTO `user_info` (`password`) VALUES ('secret');"
        with patch.object(Path, "read_text", return_value=sql):
            result = read_dump("source.sql")
        self.assertEqual(len(result["user_product"]), 2)
        self.assertEqual(result["user_product"][0]["user_product_name"], "Name; with comma, and 'quote")
        self.assertNotIn("user_info", result)

    def test_rejects_mismatched_columns(self):
        with patch.object(Path, "read_text", return_value="INSERT INTO `user_product` (`user_product_id`,`user_product_company_id`) VALUES (1);"):
            with self.assertRaises(ValueError): read_dump("source.sql")

if __name__ == "__main__": unittest.main()
